export type FormatType = 'value' | 'price' | 'amount' | 'default' | 'precise' | 'noDecimal'

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
  },
  noDecimal: {
    min: 0,
    max: 0
  }
}
const TYPES_WITH_DOLLAR_PREFIX: FormatType[] = ['value', 'price']

const MAX_SUPPORTED_DECIMALS_BY_FORMATTER = 20
const cacheForNumberFormatters: { [k: string]: Intl.NumberFormat } = {}

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
  maxDecimals: number,
  sign: string,
  type: FormatType
) => {
  // maxDecimals could be less than DECIMAL_RULES[type].min
  const minimumFractionDigits = Math.min(DECIMAL_RULES[type].min, maxDecimals)
  const maximumFractionDigits = Math.min(
    Math.max(minimumFractionDigits, maxDecimals),
    MAX_SUPPORTED_DECIMALS_BY_FORMATTER
  )

  let keyForCache = `${minimumFractionDigits}:${maximumFractionDigits}`
  if (!cacheForNumberFormatters[keyForCache])
    cacheForNumberFormatters[keyForCache] = new Intl.NumberFormat('en-US', {
      minimumFractionDigits,
      maximumFractionDigits,
      roundingMode: 'trunc'
    })

  const formatter = cacheForNumberFormatters[keyForCache]
  const reconstructedStringValue = formatter.format(value)

  return `${sign}${getPrefix(withDollarPrefix)}${reconstructedStringValue}`
}

// A function that formats a number to a string with a specific number of decimals.
// Based on the passed type it will add a dollar sign prefix.
const formatDecimals = (value: number | undefined = undefined, type: FormatType = 'default') => {
  const withDollarPrefix = TYPES_WITH_DOLLAR_PREFIX.includes(type || '')

  if (value === 0) {
    if (type === 'amount' || type === 'noDecimal') return `${getPrefix(withDollarPrefix)}0`

    return `${getPrefix(withDollarPrefix)}0.00`
  }
  if (!value || Number.isNaN(value)) return `${getPrefix(withDollarPrefix)}-`

  // The absolute value is used to determine the number of decimals and
  // then the actual value is formatted with the determined number of decimals.
  const absoluteValue = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (type === 'value') {
    let decimals = DECIMAL_RULES[type].max

    if (absoluteValue < 0.01) {
      return `${sign}<$0.01`
    }

    if (absoluteValue > 10000) {
      decimals = 0
    }

    return formatNumber(absoluteValue, withDollarPrefix, decimals, sign, type)
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
