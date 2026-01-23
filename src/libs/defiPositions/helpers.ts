import { Price } from '../../interfaces/assets'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'

const getAssetValue = (amount: bigint, decimals: number, priceIn: Price[]): number | undefined => {
  if (!priceIn.length) return undefined

  const priceInUSD = priceIn.find((p) => p.baseCurrency === 'usd')?.price
  if (!priceInUSD) return undefined

  const assetValueString = safeTokenAmountAndNumberMultiplication(amount, decimals, priceInUSD)

  return Number(assetValueString)
}

const isTokenPriceWithinHalfPercent = (price1: number, price2: number): boolean => {
  const diff = Math.abs(price1 - price2)
  const threshold = 0.005 * Math.max(Math.abs(price1), Math.abs(price2))
  return diff <= threshold
}

const getProviderId = (providerName: string): string => {
  return providerName.toLowerCase()
}

export { getAssetValue, getProviderId, isTokenPriceWithinHalfPercent }
