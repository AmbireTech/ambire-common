import { AbiCoder, getAddress, Interface, Result } from 'ethers'

import { isPrivacyPoolsNativeAsset } from '../../consts/privacyPools'
import { PrivacyPoolsPaymasterConfig } from '../../interfaces/privacyPools'

/** The parts of the SDK's `IGenericPaymasterWithdrawalPayload` read here (not exported). */
export type PrivacyPoolsPaymasterWithdrawalPayload = {
  /** The SDK stores addresses as bigints. */
  poolAddress: bigint
  paymasterAddress: string
  entryPointAddress: string
  userOperation: { sender: string; callData: string; paymaster?: string; paymasterData?: string }
}

/** `paymasterData`: the adapter the paymaster hands the withdrawal to, and its input. */
const PAYMASTER_DATA_TYPE = 'tuple(address adapter, bytes adapterData)'

/**
 * The adapter's input: the pool withdrawal and its proof. `pubSignals[2]` is the withdrawn value
 * (the circuit orders outputs before inputs).
 */
const ADAPTER_DATA_TYPE =
  'tuple(tuple(address processooor, bytes data) withdrawal, tuple(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'

/** `withdrawal.data`, as the adapter decodes it to split the funds. */
const FEE_DATA_TYPE = 'tuple(address recipient, address feeRecipient, uint256 fee)'

const WITHDRAWN_VALUE_SIGNAL_INDEX = 2

/** What the single-use sender runs after being paid - see `readBatchCalls`. */
const SENDER_INTERFACE = new Interface([
  'function executeBatch((address target, uint256 value, bytes data)[] calls)'
])

/** A deposit withdrawn by the sender itself, outside the paymaster - see `readBatchCalls`. */
const POOL_INTERFACE = new Interface([
  'function withdraw((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'
])

const ERC20_INTERFACE = new Interface(['function transfer(address to, uint256 amount)'])

const toHexAddress = (address: bigint) => getAddress(`0x${address.toString(16).padStart(40, '0')}`)

const isSameAddress = (a: string, b: string) => getAddress(a) === getAddress(b)

type BatchCall = { target: string; value: bigint; data: string }

/**
 * What a prepared paymaster withdrawal does, read from the bytes the paymaster and pool act on, so
 * it can be shown as what will happen rather than as what was asked for.
 */
export type PrivacyPoolsPaymasterWithdrawal = {
  /** Who receives the funds. */
  recipient: string
  /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  /** What leaves the Privacy Pools account, before the fee. */
  amount: bigint
  /** The cap locked into the proof, taken out of `amount`. */
  fee: bigint
  /** How many deposits the withdrawal spends. */
  noteCount: number
}

/**
 * Checks a batch withdrawal's calls and returns what the deposits beyond the sponsored one add, and
 * who the forward pays.
 *
 * The paymaster sponsors only one deposit, paid to the sender when the userOp has calls. The sender
 * must withdraw each other deposit itself, then forward the total minus the fee to the recipient -
 * in that order, and nothing else.
 */
const readBatchCalls = ({
  callData,
  sender,
  poolAddress,
  tokenAddress,
  recipient,
  amountOut
}: {
  callData: string
  sender: string
  poolAddress: string
  tokenAddress: string
  recipient: string
  amountOut: bigint
}): { withdrawnValue: bigint; noteCount: number; recipient: string } => {
  let calls: BatchCall[]
  try {
    ;[calls] = SENDER_INTERFACE.decodeFunctionData('executeBatch', callData)
  } catch {
    throw new Error('privacyPools: the withdrawal runs calls of an unexpected shape')
  }

  const withdrawCalls = calls.slice(0, -1)
  const forwardCall = calls[calls.length - 1]
  if (!forwardCall || !withdrawCalls.length)
    throw new Error('privacyPools: the withdrawal runs calls of an unexpected shape')

  const withdrawnValue = withdrawCalls.reduce((sum, call) => {
    if (!isSameAddress(call.target, poolAddress) || call.value !== 0n)
      throw new Error('privacyPools: the withdrawal calls an unexpected contract')

    let processooor: string
    let pubSignals: Result
    try {
      ;[{ processooor }, { pubSignals }] = POOL_INTERFACE.decodeFunctionData('withdraw', call.data)
    } catch {
      throw new Error('privacyPools: the withdrawal calls the pool in an unexpected way')
    }
    // The pool pays whoever submits the withdrawal, so anything else would bypass the forward
    if (!isSameAddress(processooor, sender))
      throw new Error('privacyPools: a deposit in the withdrawal pays out to an unexpected address')

    return sum + BigInt(pubSignals[WITHDRAWN_VALUE_SIGNAL_INDEX])
  }, 0n)

  const isNative = isPrivacyPoolsNativeAsset(tokenAddress)
  const expectedForwardCall: BatchCall = isNative
    ? { target: recipient, value: amountOut, data: '0x' }
    : {
        target: tokenAddress,
        value: 0n,
        data: ERC20_INTERFACE.encodeFunctionData('transfer', [recipient, amountOut])
      }
  if (
    !isSameAddress(forwardCall.target, expectedForwardCall.target) ||
    forwardCall.value !== expectedForwardCall.value ||
    forwardCall.data.toLowerCase() !== expectedForwardCall.data.toLowerCase()
  )
    throw new Error('privacyPools: the withdrawal forwards the funds differently than requested')

  const [forwardRecipient] = isNative
    ? [forwardCall.target]
    : ERC20_INTERFACE.decodeFunctionData('transfer', forwardCall.data)

  return {
    withdrawnValue,
    noteCount: withdrawCalls.length + 1,
    recipient: getAddress(forwardRecipient)
  }
}

/**
 * Decodes a prepared paymaster withdrawal and checks it against the request, returning what it
 * does - to show it from the payload rather than from the request.
 *
 * Security boundary: the SDK builds and signs the userOp in one call, so this is the one
 * place to verify, from the bytes the paymaster and pool act on, the token, the recipient, the
 * amount and the fee recipient. Any mismatch is refused before the user is asked to send it.
 *
 * A single deposit is paid straight to the recipient with no calls; a batch goes through the
 * single-use sender - see `readBatchCalls`.
 */
export const readPaymasterWithdrawal = ({
  withdrawal,
  paymaster,
  poolAddress: tokenPoolAddress,
  recipient,
  tokenAddress,
  amount
}: {
  withdrawal: PrivacyPoolsPaymasterWithdrawalPayload
  paymaster: PrivacyPoolsPaymasterConfig
  /**
   * The token's pool, as the entrypoint lists it. The payload names only a pool, and every pool has
   * an adapter, so this is what ties the withdrawal to the token.
   */
  poolAddress: string
  recipient: string
  /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  amount: bigint
}): PrivacyPoolsPaymasterWithdrawal => {
  const { userOperation } = withdrawal
  const poolAddress = toHexAddress(withdrawal.poolAddress).toLowerCase()
  const expectedAdapter = paymaster.poolAdapters[poolAddress]

  if (!expectedAdapter)
    throw new Error(`privacyPools: no paymaster adapter configured for pool ${poolAddress}`)
  // Otherwise another token's pool would pass, its amount compared as if it were this token's
  if (!isSameAddress(poolAddress, tokenPoolAddress))
    throw new Error('privacyPools: the withdrawal is from the pool of a different token')
  if (!isSameAddress(withdrawal.entryPointAddress, paymaster.entryPointAddress))
    throw new Error('privacyPools: the withdrawal targets an unexpected ERC-4337 entry point')
  if (
    !userOperation.paymaster ||
    !isSameAddress(userOperation.paymaster, paymaster.paymasterAddress) ||
    !isSameAddress(withdrawal.paymasterAddress, paymaster.paymasterAddress)
  )
    throw new Error('privacyPools: the withdrawal is sponsored by an unexpected paymaster')
  if (!userOperation.paymasterData)
    throw new Error('privacyPools: the withdrawal carries no paymaster data')

  const coder = AbiCoder.defaultAbiCoder()
  const [{ adapter, adapterData }] = coder.decode(
    [PAYMASTER_DATA_TYPE],
    userOperation.paymasterData
  )
  const [
    {
      withdrawal: { processooor, data },
      proof: { pubSignals }
    }
  ] = coder.decode([ADAPTER_DATA_TYPE], adapterData)
  const [feeData] = coder.decode([FEE_DATA_TYPE], data)

  if (!isSameAddress(adapter, expectedAdapter) || !isSameAddress(processooor, expectedAdapter))
    throw new Error('privacyPools: the withdrawal is routed through an unexpected adapter')
  if (!isSameAddress(feeData.feeRecipient, paymaster.paymasterAddress))
    throw new Error('privacyPools: the withdrawal fee goes to an unexpected address')

  const fee = BigInt(feeData.fee)
  const sponsoredValue = BigInt(pubSignals[WITHDRAWN_VALUE_SIGNAL_INDEX])
  const isPaidToRecipient = isSameAddress(feeData.recipient, recipient)
  if (!isPaidToRecipient && !isSameAddress(feeData.recipient, userOperation.sender))
    throw new Error('privacyPools: the withdrawal pays out to a different address than requested')
  if (isPaidToRecipient && userOperation.callData !== '0x')
    throw new Error('privacyPools: the withdrawal runs calls it should not')
  if (fee >= amount) throw new Error('privacyPools: the withdrawal fee would take the whole amount')

  const batch = isPaidToRecipient
    ? { withdrawnValue: 0n, noteCount: 1, recipient: getAddress(feeData.recipient) }
    : readBatchCalls({
        callData: userOperation.callData,
        sender: userOperation.sender,
        poolAddress,
        tokenAddress,
        recipient,
        amountOut: amount - fee
      })

  const withdrawnAmount = sponsoredValue + batch.withdrawnValue
  if (withdrawnAmount !== amount)
    throw new Error('privacyPools: the withdrawal proves a different amount than requested')

  return {
    recipient: batch.recipient,
    // The pool's token: the pool is checked above to be the one the entrypoint lists for it
    tokenAddress,
    amount: withdrawnAmount,
    fee,
    noteCount: batch.noteCount
  }
}
