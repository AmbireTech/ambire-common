const FEE_RESERVE_OVERHEAD_BPS = 2000n
const BPS = 10000n

const getFeeWithReserveOverhead = (fee: bigint): bigint => {
  if (fee === 0n) return 0n

  // here we do BPS - 1n for ceiling division, i.e. to round up 3.6 to 4
  return (fee * (BPS + FEE_RESERVE_OVERHEAD_BPS) + BPS - 1n) / BPS
}

const getAmountAfterFeeReserve = (amount: bigint, fee: bigint): bigint => {
  const feeWithOverhead = getFeeWithReserveOverhead(fee)

  return amount > feeWithOverhead ? amount - feeWithOverhead : 0n
}

const getAmountAfterFeeSync = ({
  currentAmount,
  totalAmount,
  fee,
  reservedFee,
  shouldReserveFee,
  isMaxAmountSelected
}: {
  currentAmount: bigint
  totalAmount: bigint
  fee: bigint
  reservedFee?: bigint
  shouldReserveFee: boolean
  isMaxAmountSelected: boolean
}): bigint => {
  const feeToReserve = reservedFee && reservedFee > fee ? reservedFee : fee
  const maxTransferableAmount = shouldReserveFee
    ? getAmountAfterFeeReserve(totalAmount, feeToReserve)
    : totalAmount

  if (isMaxAmountSelected) return maxTransferableAmount
  if (!shouldReserveFee) return currentAmount

  return currentAmount > maxTransferableAmount ? maxTransferableAmount : currentAmount
}

/**
 * Removes any extra decimals from the amount.
 * @example getSanitizedAmount('1.123456', 2) => '1.12'
 */
const getSanitizedAmount = (amount: string, decimals: number): string => {
  const sanitizedAmount = amount.split('.')

  if (sanitizedAmount[1]) sanitizedAmount[1] = sanitizedAmount[1].slice(0, decimals)

  return sanitizedAmount.join('.')
}

export { getAmountAfterFeeReserve, getAmountAfterFeeSync, getSanitizedAmount }
