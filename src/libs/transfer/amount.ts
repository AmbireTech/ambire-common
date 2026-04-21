const getAmountAfterFeeReserve = (amount: bigint, fee: bigint): bigint => {
  return amount > fee ? amount - fee : 0n
}

const getAmountAfterFeeSync = ({
  currentAmount,
  totalAmount,
  fee,
  shouldReserveFee,
  isMaxAmountSelected
}: {
  currentAmount: bigint
  totalAmount: bigint
  fee: bigint
  shouldReserveFee: boolean
  isMaxAmountSelected: boolean
}): bigint => {
  const maxTransferableAmount = shouldReserveFee
    ? getAmountAfterFeeReserve(totalAmount, fee)
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
