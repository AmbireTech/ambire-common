import { Price } from '../../interfaces/assets'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'

const sortByValue = (aValue?: number, bValue?: number) => {
  if (aValue && bValue) {
    return bValue - aValue
  }
  if (aValue && !bValue) {
    return -1
  }
  if (!aValue && bValue) {
    return 1
  }

  return 0
}

const getAssetValue = (amount: bigint, decimals: number, priceIn: Price[]): number | undefined => {
  if (!priceIn.length) return undefined

  const priceInUSD = priceIn.find((p) => p.baseCurrency === 'usd')?.price
  if (!priceInUSD) return undefined

  const assetValueString = safeTokenAmountAndNumberMultiplication(amount, decimals, priceInUSD)

  return Number(assetValueString)
}

export { sortByValue, getAssetValue }
