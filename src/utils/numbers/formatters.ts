import { formatUnits, parseUnits } from 'ethers'

import { getSanitizedAmount } from '../../libs/transfer/amount'

/**
 * Converts floating point token price to big int
 */
const convertTokenPriceToBigInt = (
  tokenPrice: number
): {
  tokenPriceBigInt: bigint
  tokenPriceDecimals: number
} => {
  const tokenPriceString = String(tokenPrice)

  // Scientific notation handling
  if (tokenPriceString.includes('e')) {
    const [base, rawExponent] = tokenPriceString.split('e')
    const exponent = Math.abs(Number(rawExponent))

    const { tokenPriceBigInt, tokenPriceDecimals: baseDecimals } = convertTokenPriceToBigInt(
      Number(base)
    )

    return {
      tokenPriceBigInt,
      tokenPriceDecimals: baseDecimals + exponent
    }
  }

  // Regular number handling
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

export {
  convertTokenPriceToBigInt,
  safeTokenAmountAndNumberMultiplication,
  getSafeAmountFromFieldValue
}
