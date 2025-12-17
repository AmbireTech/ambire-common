import { Price } from '../../interfaces/assets'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'

const getAssetValue = (amount: bigint, decimals: number, priceIn: Price[]): number | undefined => {
  if (!priceIn.length) return undefined

  const priceInUSD = priceIn.find((p) => p.baseCurrency === 'usd')?.price
  if (!priceInUSD) return undefined

  const assetValueString = safeTokenAmountAndNumberMultiplication(amount, decimals, priceInUSD)

  return Number(assetValueString)
}

export const getProviderId = (providerName: string): string => {
  return providerName.toLowerCase()
}

export { getAssetValue }
