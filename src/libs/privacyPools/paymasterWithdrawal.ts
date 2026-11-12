import { AbiCoder, getAddress } from 'ethers'

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

/**
 * `withdrawal.data`, as the adapter decodes it to split the funds. `refundRecipient` gets the part
 * of the fee gas does not use, in the paymaster's postOp.
 */
const FEE_DATA_TYPE =
  'tuple(address recipient, address feeRecipient, uint256 fee, address refundRecipient)'

const WITHDRAWN_VALUE_SIGNAL_INDEX = 2

const toHexAddress = (address: bigint) => getAddress(`0x${address.toString(16).padStart(40, '0')}`)

const isSameAddress = (a: string, b: string) => getAddress(a) === getAddress(b)

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
}

/**
 * Decodes a prepared paymaster withdrawal and checks it against the request, returning what it
 * does - to show it from the payload rather than from the request.
 *
 * Security boundary: the SDK builds and signs the userOp in one call, so this is the one
 * place to verify, from the bytes the paymaster and pool act on, the token, the recipient, the
 * amount, the fee recipient and the refund recipient. Any mismatch is refused before the user is
 * asked to send it.
 *
 * It spends a single deposit, paid straight to the recipient with no calls.
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
  if (!isSameAddress(feeData.refundRecipient, recipient))
    throw new Error('privacyPools: the withdrawal refunds unused gas to an unexpected address')

  const fee = BigInt(feeData.fee)
  const withdrawnAmount = BigInt(pubSignals[WITHDRAWN_VALUE_SIGNAL_INDEX])
  if (!isSameAddress(feeData.recipient, recipient))
    throw new Error('privacyPools: the withdrawal pays out to a different address than requested')
  if (userOperation.callData !== '0x')
    throw new Error('privacyPools: the withdrawal runs calls it should not')
  if (fee >= amount) throw new Error('privacyPools: the withdrawal fee would take the whole amount')
  if (withdrawnAmount !== amount)
    throw new Error('privacyPools: the withdrawal proves a different amount than requested')

  return {
    recipient: getAddress(feeData.recipient),
    // The pool's token: the pool is checked above to be the one the entrypoint lists for it
    tokenAddress,
    amount: withdrawnAmount,
    fee
  }
}
