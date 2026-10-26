import { formatUnits, parseUnits } from 'ethers'

import { CONVERSION_PRECISION, CONVERSION_PRECISION_POW } from '../../consts/swapAndBridge'
import {
  convertTokenPriceToBigInt,
  getSafeAmountFromFieldValue,
  truncateFiatAmountDecimals
} from '../../utils/numbers/formatters'
import { getSanitizedAmount } from './amount'

// Precision of a typed USD amount before conversion
const FIAT_FIELD_DECIMALS = 10

type AmountFieldMode = 'token' | 'fiat'

/**
 * Token and USD amounts of a Send amount field, typed in either. With no price, the input is the
 * token amount and there is no USD value. An empty input gives empty amounts.
 */
const getAmountsFromFieldValue = ({
  fieldValue,
  fieldMode,
  price,
  decimals
}: {
  fieldValue: string
  fieldMode: AmountFieldMode
  price: number | null
  decimals: number
}): { amount: string; amountInFiat: string } => {
  if (!fieldValue) return { amount: '', amountInFiat: '' }
  if (!price) return { amount: fieldValue, amountInFiat: '' }

  const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(price)

  if (fieldMode === 'fiat') {
    const sanitizedFiat = getSanitizedAmount(fieldValue, FIAT_FIELD_DECIMALS)
    const amountInFiatBigInt = sanitizedFiat ? parseUnits(sanitizedFiat, FIAT_FIELD_DECIMALS) : 0n

    return {
      amount: formatUnits(
        (amountInFiatBigInt * CONVERSION_PRECISION_POW) / tokenPriceBigInt,
        // Shift the decimal point by the number of decimals in the token price
        FIAT_FIELD_DECIMALS + CONVERSION_PRECISION - tokenPriceDecimals
      ),
      amountInFiat: fieldValue
    }
  }

  const tokenAmount = parseUnits(getSafeAmountFromFieldValue(fieldValue, decimals), decimals)

  return {
    amount: fieldValue,
    // The fiat field shows this as-is when switched to, so cut it down to a displayable
    // precision instead of the token's full one (up to 18 decimals)
    amountInFiat: truncateFiatAmountDecimals(
      formatUnits(
        tokenAmount * tokenPriceBigInt,
        // Shift the decimal point by the number of decimals in the token price
        decimals + tokenPriceDecimals
      )
    )
  }
}

export type { AmountFieldMode }
export { getAmountsFromFieldValue }
