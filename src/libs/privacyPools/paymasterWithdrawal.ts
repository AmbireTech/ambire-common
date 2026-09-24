import { AbiCoder, getAddress } from 'ethers'

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
  userOperation: { paymaster?: string; paymasterData?: string }
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

const toHexAddress = (address: bigint) => getAddress(`0x${address.toString(16).padStart(40, '0')}`)

const isSameAddress = (a: string, b: string) => getAddress(a) === getAddress(b)

/**
 * Decodes a prepared paymaster withdrawal and checks it against what the user asked for, returning
 * the fee it pays.
 *
 * The SDK builds and signs the userOp in one call and hands back only the result, so this is the
 * one place to confirm - from the bytes the paymaster and the pool will act on, not from the SDK's
 * word - that the funds go to the address the user typed, that the amount is theirs, and that the
 * fee goes to the paymaster we configured. The package is an unaudited alpha; anything that
 * disagrees is refused before the user is ever asked to send it.
 */
export const readPaymasterWithdrawal = ({
  withdrawal,
  paymaster,
  recipient,
  amount
}: {
  withdrawal: PrivacyPoolsPaymasterWithdrawalPayload
  paymaster: PrivacyPoolsPaymasterConfig
  recipient: string
  amount: bigint
}): { fee: bigint } => {
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
  if (!isSameAddress(feeData.recipient, recipient))
    throw new Error('privacyPools: the withdrawal pays out to a different address than requested')
  if (!isSameAddress(feeData.feeRecipient, paymaster.paymasterAddress))
    throw new Error('privacyPools: the withdrawal fee goes to an unexpected address')
  if (BigInt(pubSignals[WITHDRAWN_VALUE_SIGNAL_INDEX]) !== amount)
    throw new Error('privacyPools: the withdrawal proves a different amount than requested')

  const fee = BigInt(feeData.fee)
  if (fee >= amount) throw new Error('privacyPools: the withdrawal fee would take the whole amount')

  return { fee }
}
