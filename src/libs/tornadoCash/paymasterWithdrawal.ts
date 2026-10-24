import { AbiCoder, getAddress, Interface } from 'ethers'

import { TORNADO_CASH_PAYMASTER, TornadoCashPool } from '../../consts/tornadoCash'
import { TornadoCashPaymasterWithdrawal } from '../../interfaces/tornadoCash'
import { getTornadoCashPool } from './deposit'

/** The account code the single-use sender delegates to (EIP-7702), as the SDK builds it. */
export const TORNADO_CASH_SIMPLE_7702_IMPLEMENTATION = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const abiCoder = AbiCoder.defaultAbiCoder()

const ACCOUNT_INTERFACE = new Interface([
  'function executeBatch((address target, uint256 value, bytes data)[] calls)'
])

const POOL_INTERFACE = new Interface([
  'function withdraw(bytes _proof, bytes32 _root, bytes32 _nullifierHash, address _recipient, address _relayer, uint256 _fee, uint256 _refund)'
])

const ERC20_INTERFACE = new Interface(['function transfer(address to, uint256 amount)'])

/** What a checked withdrawal does, in the units of its asset. */
export type TornadoCashWithdrawalSummary = {
  pools: TornadoCashPool[]
  /** The sum of the withdrawn notes. */
  amount: bigint
  /** Paid to the paymaster from the sponsoring note, for the whole operation's gas. */
  fee: bigint
  /** What reaches the recipient: `amount - fee`. */
  recipientReceives: bigint
  sender: string
}

const sameAddress = (a: string | undefined | null, b: string | undefined | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** Decodes the paymaster's data: the pool's fee adapter and the withdrawal it is paid from. */
const readPaymasterData = (paymasterData: string) => {
  const [{ adapter, adapterData }] = abiCoder.decode(
    ['(address adapter, bytes adapterData)'],
    paymasterData
  )
  const [{ recipient, relayer, fee, refund }] = abiCoder.decode(
    [
      '(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund)'
    ],
    adapterData
  )

  return {
    adapter: String(adapter),
    recipient: String(recipient),
    relayer: String(relayer),
    fee: BigInt(fee),
    refund: BigInt(refund)
  }
}

/**
 * Checks a withdrawal the SDK built and signed before it is shown or broadcast, and describes it.
 * The SDK runs outside the background, so nothing it returns is trusted: this is the security
 * boundary that makes sure the notes' value reaches `recipient` and nobody else, minus a fee no
 * larger than the sponsoring note.
 *
 * One note is withdrawn in the paymaster's validation straight to the recipient. Several are
 * withdrawn to the single-use sender (one in validation, the rest by the account itself) and then
 * forwarded in one transfer.
 *
 * Throws when anything does not match.
 */
export const readTornadoCashPaymasterWithdrawal = ({
  withdrawal,
  assetAddress,
  recipient
}: {
  withdrawal: TornadoCashPaymasterWithdrawal
  assetAddress: string
  recipient: string
}): TornadoCashWithdrawalSummary => {
  const { userOperation } = withdrawal
  const fail = (reason: string): never => {
    throw new Error(`tornadoCash: the withdrawal ${reason}`)
  }

  if (!sameAddress(withdrawal.entryPointAddress, TORNADO_CASH_PAYMASTER.entryPointAddress))
    fail('uses another entry point')
  if (!sameAddress(userOperation.paymaster, TORNADO_CASH_PAYMASTER.paymasterAddress))
    fail('uses another paymaster')
  if (!sameAddress(userOperation.eip7702Auth?.address, TORNADO_CASH_SIMPLE_7702_IMPLEMENTATION))
    fail('delegates the sender to unknown code')
  if (!userOperation.paymasterData) fail('has no paymaster data')

  const sponsoringPool = getTornadoCashPool(withdrawal.poolAddress)
  if (!sponsoringPool || !sameAddress(sponsoringPool.assetAddress, assetAddress))
    fail('pays from an unknown pool')

  const sponsored = readPaymasterData(userOperation.paymasterData!)
  if (!sameAddress(sponsored.adapter, sponsoringPool!.feeAdapterAddress))
    fail("pays through another pool's adapter")
  if (!sameAddress(sponsored.relayer, TORNADO_CASH_PAYMASTER.paymasterAddress))
    fail('pays its fee to someone else')
  if (sponsored.refund !== 0n) fail('asks for a refund')
  if (sponsored.fee >= sponsoringPool!.denomination) fail('costs more than the note')

  const { sender } = userOperation

  // One note: straight to the recipient, nothing for the account to run
  if (userOperation.callData === '0x') {
    if (!sameAddress(sponsored.recipient, recipient)) fail('pays someone else')

    return {
      pools: [sponsoringPool!],
      amount: sponsoringPool!.denomination,
      fee: sponsored.fee,
      recipientReceives: sponsoringPool!.denomination - sponsored.fee,
      sender
    }
  }

  // Several notes: all to the sender, which forwards them in its last call
  if (!sameAddress(sponsored.recipient, sender)) fail('pays the sponsoring note to someone else')

  const [batch] = ACCOUNT_INTERFACE.decodeFunctionData('executeBatch', userOperation.callData)
  const calls = batch as { target: string; value: bigint; data: string }[]
  const forward = calls[calls.length - 1]
  const directWithdrawals = calls.slice(0, -1)
  if (!forward || !directWithdrawals.length) fail('has no notes to add')

  const pools = [sponsoringPool!]
  directWithdrawals.forEach(({ target, value, data }) => {
    const pool = getTornadoCashPool(target)
    if (!pool || !sameAddress(pool.assetAddress, assetAddress) || value !== 0n)
      fail('withdraws from an unknown pool')

    const [, , , withdrawalRecipient, relayer, fee, refund] = POOL_INTERFACE.decodeFunctionData(
      'withdraw',
      data
    )
    if (!sameAddress(withdrawalRecipient, sender)) fail('sends a note to someone else')
    if (!sameAddress(relayer, ZERO_ADDRESS) || fee !== 0n || refund !== 0n)
      fail('pays a fee from a note it adds')

    pools.push(pool!)
  })

  const amount = pools.reduce((sum, pool) => sum + pool.denomination, 0n)
  const recipientReceives = amount - sponsored.fee

  const isNative = sameAddress(assetAddress, ZERO_ADDRESS)
  if (isNative) {
    if (!sameAddress(forward!.target, recipient) || forward!.data !== '0x')
      fail('forwards the funds to someone else')
    if (forward!.value !== recipientReceives) fail('forwards another amount')
  } else {
    if (!sameAddress(forward!.target, getAddress(assetAddress)) || forward!.value !== 0n)
      fail('forwards another token')
    const [to, forwarded] = ERC20_INTERFACE.decodeFunctionData('transfer', forward!.data)
    if (!sameAddress(to, recipient)) fail('forwards the funds to someone else')
    if (forwarded !== recipientReceives) fail('forwards another amount')
  }

  return { pools, amount, fee: sponsored.fee, recipientReceives, sender }
}
