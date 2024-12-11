type FormatType = 'value' | 'price' | 'amount' | 'default' | 'precise'

const DEFAULT_DECIMALS = 2
const DECIMAL_RULES = {
  value: {
    min: 2,
    max: 2
  },
  price: {
    min: 2,
    max: 2
  },
  amount: {
    min: 0,
    max: 2
  },
  default: {
    min: 0,
    max: 2
  },
  precise: {
    min: 0,
    max: 8
  }
}
const TYPES_WITH_DOLLAR_PREFIX: FormatType[] = ['value', 'price']

/**
 * Removes trailing zeros from a decimal string.
 * @example
 * removeTrailingZeros('1.0500') // '1.05'
 */
const removeTrailingZeros = (decimalStr: string, minDecimals: number = 0) => {
  if (!decimalStr.includes('.')) return decimalStr // If there's no decimal point, return the original string

  let result = decimalStr

  // Loop from the end of the string until a non-zero character is found
  while (
    result.endsWith('0') &&
    (!minDecimals || result.length - 1 - result.indexOf('.') > minDecimals)
  ) {
    result = result.slice(0, -1) // Remove the last character
  }

  // If the string ends with a decimal point after removing zeros, remove it
  if (result.endsWith('.')) {
    result = result.slice(0, -1)
  }

  return result
}

const getIndexOfFirstNonZeroInDecimals = (value: number, type: FormatType) => {
  // Fixes scientific notation when converting to string
  const decimalValue = value.toFixed(value < 1 ? 16 : 2)
  const valueString = decimalValue.toString()
  const indexOfDot = valueString.indexOf('.')
  if (indexOfDot === -1) return 0
  const decimals = valueString.slice(indexOfDot + 1)
  const indexOfFirstNonZero = decimals.split('').findIndex((char) => char !== '0')

  return indexOfFirstNonZero === -1 ? DECIMAL_RULES[type].min : indexOfFirstNonZero
}

const getPrefix = (widthDollarPrefix: boolean) => (widthDollarPrefix ? '$' : '')

const formatNumber = (
  value: number,
  withDollarPrefix: boolean,
  decimals: number,
  sign: string,
  type: FormatType
) => {
  const stringValue = value.toFixed(16)
  const [integer, decimal] = stringValue.split('.')
  // Display the number with the determined number of decimals
  const decimalFormatted = decimal.slice(0, decimals)
  // Add commas to the integer part of the number. E.g. 1000 -> 1,000
  const integerFormatted = Number(integer).toLocaleString('en-US', { maximumFractionDigits: 0 })
  const reconstructedStringValue = `${integerFormatted}.${decimalFormatted}`
  const stringValueWithoutTrailingZeros = removeTrailingZeros(
    reconstructedStringValue,
    type ? DECIMAL_RULES[type].min : undefined
  )

  return `${sign}${getPrefix(withDollarPrefix)}${stringValueWithoutTrailingZeros}`
}

// A function that formats a number to a string with a specific number of decimals.
// Based on the passed type it will add a dollar sign prefix.
const formatDecimals = (value: number | undefined = undefined, type: FormatType = 'default') => {
  const withDollarPrefix = TYPES_WITH_DOLLAR_PREFIX.includes(type || '')

  if (value === 0) {
    if (type === 'amount') return `${getPrefix(withDollarPrefix)}0`

    return `${getPrefix(withDollarPrefix)}0.00`
  }
  if (!value || Number.isNaN(value)) return `${getPrefix(withDollarPrefix)}-`

  // The absolute value is used to determine the number of decimals and
  // then the actual value is formatted with the determined number of decimals.
  const absoluteValue = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (type === 'value') {
    if (absoluteValue < 0.01) {
      return `${sign}<$0.01`
    }

    return formatNumber(absoluteValue, withDollarPrefix, DEFAULT_DECIMALS, sign, type)
  }

  if (type === 'amount') {
    if (absoluteValue < 0.00001) {
      return `${sign}<0.00001`
    }
  }

  const indexOfFirstNonZero = getIndexOfFirstNonZeroInDecimals(value, type)

  const decimals = indexOfFirstNonZero + DECIMAL_RULES[type].max

  return formatNumber(absoluteValue, withDollarPrefix, decimals, sign, type)
}

export default formatDecimals
