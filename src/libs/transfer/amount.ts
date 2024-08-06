/**
 * Removes any extra decimals from the amount.
 * @example getSanitizedAmount('1.123456', 2) => '1.12'
 */
const getSanitizedAmount = (amount: string, decimals: number): string => {
  const sanitizedAmount = amount.split('.')

  if (sanitizedAmount[1]) sanitizedAmount[1] = sanitizedAmount[1].slice(0, decimals)

  return sanitizedAmount.join('.')
}

export { getSanitizedAmount }
