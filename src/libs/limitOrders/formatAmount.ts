/** "1234567" as "1,234,567" */
const groupThousands = (integerDigits: string): string => {
  const groups: string[] = []
  for (let end = integerDigits.length; end > 0; end -= 3) {
    groups.unshift(integerDigits.slice(Math.max(end - 3, 0), end))
  }

  return groups.join(',')
}

/**
 * Formats a limit order's token amount, given as an exact decimal string (what `formatUnits`
 * returns). Two decimals from 100 up, four from 1 up, and four significant digits below 1, so a
 * large amount isn't spelled out to nine decimals (115.05 ADX) and a small one keeps what matters
 * (0.00008159 WBTC). The extra digits are cut, never rounded up, so it never shows more than an
 * order guarantees or received. My orders and the banner about filled orders both use it, so the
 * user can compare their amounts digit by digit
 */
export const formatLimitOrderAmount = (exactAmount: string): string => {
  const [integerPart = '0', fractionPart = ''] = exactAmount.split('.')
  const integerValue = BigInt(integerPart || '0')
  const firstSignificantIndex = fractionPart.split('').findIndex((digit) => digit !== '0')

  let decimals = 4
  if (integerValue >= 100n) decimals = 2
  if (integerValue === 0n) decimals = firstSignificantIndex === -1 ? 0 : firstSignificantIndex + 4

  const fractionDigits = fractionPart.slice(0, decimals).split('')
  while (fractionDigits[fractionDigits.length - 1] === '0') fractionDigits.pop()
  const integer = groupThousands(integerValue.toString())

  return fractionDigits.length ? `${integer}.${fractionDigits.join('')}` : integer
}
