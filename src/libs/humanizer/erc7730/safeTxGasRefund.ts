import { getAddress, isAddress, ZeroAddress } from 'ethers'

/** Details of a Safe transaction's additional gas-refund payment. */
export type SafeTxGasRefund = {
  // undefined when `refundReceiver` is the zero address - Safe.sol's handlePayment then pays
  // tx.origin (whoever broadcasts this transaction) instead of a fixed address, it does NOT mean
  // no refund is paid
  refundReceiver?: string
  gasToken: string
  // `gasUsed * effectiveGasPrice` is always added on top of this at execution time and can't be
  // known ahead of time, so this is only the extra, fully attacker-controlled additive component
  // (`baseGas * gasPrice`) - a guaranteed floor when nonzero, but frequently zero on its own
  // (baseGas defaults to 0), in which case the real payment still happens, its size just isn't
  // predictable from calldata alone
  minAmount: bigint
}

const toBigIntOrNull = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' || typeof value === 'string') {
    try {
      return BigInt(value)
    } catch {
      return null
    }
  }

  return null
}

/**
 * Safe.sol's execTransaction only pays a gas refund at all when `gasPrice > 0` - see the
 * `if (gasPrice > 0) { payment = handlePayment(...) }` guard - independent of `baseGas`, which
 * only adds to the payment on top of the real (unknowable ahead of time) execution gas cost. Both
 * are static SafeTx/execTransaction fields, decodable without a relayer or ERC-7730 descriptor, so
 * this never depends on what fields an external descriptor declares - it works the same whether
 * the source is a signed SafeTx message or a broadcast execTransaction call.
 */
export const buildSafeTxGasRefund = (
  baseGas: unknown,
  gasPrice: unknown,
  gasToken: unknown,
  refundReceiver: unknown
): SafeTxGasRefund | null => {
  const bigintBaseGas = toBigIntOrNull(baseGas ?? 0)
  const bigintGasPrice = toBigIntOrNull(gasPrice ?? 0)
  if (bigintBaseGas === null || bigintGasPrice === null || bigintGasPrice <= 0n) return null

  const receiver =
    typeof refundReceiver === 'string' && isAddress(refundReceiver)
      ? getAddress(refundReceiver)
      : null

  return {
    refundReceiver: receiver && receiver !== ZeroAddress ? receiver : undefined,
    gasToken:
      typeof gasToken === 'string' && isAddress(gasToken) ? getAddress(gasToken) : ZeroAddress,
    minAmount: bigintBaseGas * bigintGasPrice
  }
}
