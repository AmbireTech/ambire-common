import { AbiCoder, getAddress, Interface, Result } from 'ethers'

import { isPrivacyPoolsNativeAsset } from '../../consts/privacyPools'
import { PrivacyPoolsPaymasterConfig } from '../../interfaces/privacyPools'

/**
 * The parts of the SDK's `IGenericPaymasterWithdrawalPayload` this module reads. Declared here
 * rather than imported because the SDK does not export the type from its entry point. TypeScript is
 * structural, so the SDK's payload still satisfies it.
 */
export type PrivacyPoolsPaymasterWithdrawalPayload = {
  /** The SDK stores addresses as bigints. */
  poolAddress: bigint
  paymasterAddress: string
  entryPointAddress: string
  userOperation: { sender: string; callData: string; paymaster?: string; paymasterData?: string }
}

/**
 * `(address adapter, bytes adapterData)` - what the paymaster reads from `paymasterData` to know
 * which adapter to hand the withdrawal to.
 */
const PAYMASTER_DATA_TYPE = 'tuple(address adapter, bytes adapterData)'

/**
 * The adapter's input: the pool withdrawal it submits, and the proof over it. `pubSignals[2]` is the
 * withdrawn value, in the circuit's output-then-input signal order.
 */
const ADAPTER_DATA_TYPE =
  'tuple(tuple(address processooor, bytes data) withdrawal, tuple(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'

/** `withdrawal.data` as the adapter decodes it before splitting the funds. */
const FEE_DATA_TYPE = 'tuple(address recipient, address feeRecipient, uint256 fee)'

const WITHDRAWN_VALUE_SIGNAL_INDEX = 2

/** What the single-use sender runs once the paymaster has paid it - see `readBatchCalls`. */
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
 * Reads the calls a batch withdrawal runs after its first deposit is paid out, returning what the
 * other deposits add to it.
 *
 * A batch spends several deposits in one userOp. The paymaster can only sponsor one of them, and
 * when the userOp runs calls of its own the adapter pays that one to the sender rather than to the
 * recipient. So the sender withdraws each other deposit itself, then forwards everything, minus the
 * fee, to the recipient - in that order, and nothing else.
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
}): { withdrawnValue: bigint; noteCount: number } => {
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
    // The pool pays whoever submits the withdrawal, so a deposit made out to anyone else would
    // never reach the forwarding call
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

  return { withdrawnValue, noteCount: withdrawCalls.length + 1 }
}

/**
 * Decodes a prepared paymaster withdrawal and checks it against what the user asked for, returning
 * the fee it pays and how many deposits it spends.
 *
 * The SDK builds and signs the userOp in one call and hands back only the result, so this is the
 * one place to confirm - from the bytes the paymaster and the pool will act on, not from the SDK's
 * word - that the funds go to the address the user typed, that the amount is theirs, and that the
 * fee goes to the paymaster we configured. The package is an unaudited alpha; anything that
 * disagrees is refused before the user is ever asked to send it.
 *
 * A single deposit is paid straight to the recipient and runs no calls. A batch is paid to the
 * single-use sender, which then forwards it - see `readBatchCalls`.
 */
export const readPaymasterWithdrawal = ({
  withdrawal,
  paymaster,
  recipient,
  tokenAddress,
  amount
}: {
  withdrawal: PrivacyPoolsPaymasterWithdrawalPayload
  paymaster: PrivacyPoolsPaymasterConfig
  recipient: string
  /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  amount: bigint
}): { fee: bigint; noteCount: number } => {
  const { userOperation } = withdrawal
  const poolAddress = toHexAddress(withdrawal.poolAddress).toLowerCase()
  const expectedAdapter = paymaster.poolAdapters[poolAddress]

  if (!expectedAdapter)
    throw new Error(`privacyPools: no paymaster adapter configured for pool ${poolAddress}`)
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
    ? { withdrawnValue: 0n, noteCount: 1 }
    : readBatchCalls({
        callData: userOperation.callData,
        sender: userOperation.sender,
        poolAddress,
        tokenAddress,
        recipient,
        amountOut: amount - fee
      })

  if (sponsoredValue + batch.withdrawnValue !== amount)
    throw new Error('privacyPools: the withdrawal proves a different amount than requested')

  return { fee, noteCount: batch.noteCount }
}
