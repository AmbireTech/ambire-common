import { formatUnits, parseUnits } from 'ethers'

import { getSanitizedAmount } from '../../libs/transfer/amount'
import formatDecimals from '../formatDecimals/formatDecimals'

/**
 * Writes a number as a plain decimal string that `parseUnits` accepts. `String()`
 * uses exponent notation for numbers below 1e-6 or from 1e21 up, like `5.3e-7`.
 * @example numberToDecimalString(5.3e-7) => '0.00000053'
 */
const numberToDecimalString = (value: number | bigint): string => {
  const [mantissa = '', exponentPart] = String(value).split('e')
  if (exponentPart === undefined) return mantissa

  const sign = mantissa.startsWith('-') ? '-' : ''
  const [wholePart = '', fractionPart = ''] = (sign ? mantissa.slice(1) : mantissa).split('.')
  const digits = `${wholePart}${fractionPart}`
  const pointIndex = wholePart.length + Number(exponentPart)

  if (pointIndex <= 0) return `${sign}0.${'0'.repeat(-pointIndex)}${digits}`
  if (pointIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(pointIndex - digits.length)}`
  }

  return `${sign}${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`
}

/**
 * Converts floating point token price to big int
 */
const convertTokenPriceToBigInt = (
  tokenPrice: number
): {
  tokenPriceBigInt: bigint
  tokenPriceDecimals: number
} => {
  const tokenPriceString = numberToDecimalString(tokenPrice)

  const tokenPriceDecimals = tokenPriceString.split('.')[1]?.length || 0
  const tokenPriceBigInt = parseUnits(tokenPriceString, tokenPriceDecimals)

  return { tokenPriceBigInt, tokenPriceDecimals }
}

const safeTokenAmountAndNumberMultiplication = (
  amount: bigint,
  decimals: number,
  tokenPrice: number
) => {
  const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

  return formatUnits(
    amount * tokenPriceBigInt,
    // Shift the decimal point by the number of decimals in the token price
    decimals + tokenPriceDecimals
  )
}

/**
 * Sanitizes the amount by removing values outside of the token's decimal range.
 * Also formats `.`, `.${number}` and `${number}.` to `0.0`, `0.${number}` and `${number}.0` respectively
 */
const getSafeAmountFromFieldValue = (fieldValue: string, tokenDecimals?: number): string => {
  let parsedFieldValue = fieldValue.trim()

  if (fieldValue.startsWith('.')) {
    // If the amount starts with a dot, prepend a zero
    parsedFieldValue = `0${parsedFieldValue}`
  }

  if (fieldValue.endsWith('.')) {
    // If the amount ends with a dot, append a zero
    parsedFieldValue = `${parsedFieldValue}0`
  }

  // Don't sanitize the amount if there is no selected token
  if (!tokenDecimals) return parsedFieldValue

  return getSanitizedAmount(parsedFieldValue, tokenDecimals)
}

const getDisplayedDecimalsCount = (fiatAmount: string): number => {
  const formatted = formatDecimals(Number(fiatAmount), 'price')
  const indexOfDot = formatted.indexOf('.')

  return indexOfDot === -1 ? 0 : formatted.length - indexOfDot - 1
}

/**
 * Cuts a fiat amount down to the precision a currency field can display. The
 * number of decimals is taken from what `formatDecimals` shows for the same
 * amount.
 */
const truncateFiatAmountDecimals = (fiatAmount: string): string => {
  const [wholePart, decimals] = fiatAmount.split('.')

  if (!decimals) return fiatAmount

  const decimalsToKeep = getDisplayedDecimalsCount(fiatAmount)
  const truncated =
    decimals.length <= decimalsToKeep
      ? fiatAmount
      : `${wholePart}.${decimals.slice(0, decimalsToKeep)}`

  return Number(truncated) === 0 ? '0' : truncated
}

const textToValidDecimal = (text: string) => {
  let formatted = text

  // Remove invalid chars (only digits and dots allowed)
  formatted = formatted.replace(/[^0-9.]/g, '')

  // If input starts with ".", prefix with "0"
  if (formatted.startsWith('.')) {
    formatted = `0${formatted}`
  }

  // Prevent multiple decimals
  const parts = formatted.split('.')
  if (parts.length > 2) {
    formatted = `${parts[0]}.${parts.slice(1).join('')}`
  }

  formatted = formatted.replace(/^0+(?=\d)/, '')
  if (formatted === '') formatted = '0'

  return formatted
}

export {
  convertTokenPriceToBigInt,
  getSafeAmountFromFieldValue,
  numberToDecimalString,
  safeTokenAmountAndNumberMultiplication,
  textToValidDecimal,
  truncateFiatAmountDecimals
}
