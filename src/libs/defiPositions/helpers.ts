import { Price } from '../../interfaces/assets'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import { AssetType, DefiValues, Position, PositionsByProvider } from './types'

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

const getPositionBorrowedValue = (position: Position): number =>
  position.assets.reduce(
    (sum, asset) => (asset.type === AssetType.Borrow ? sum + (asset.value || 0) : sum),
    0
  )

/**
 * Sets the value without loans of the app and each of its positions, from the value of the
 * assets they borrowed.
 */
const withCollateralValues = (provider: PositionsByProvider): PositionsByProvider => {
  let providerBorrowedValue = 0
  const positions = provider.positions.map((position) => {
    const borrowedValue = getPositionBorrowedValue(position)
    providerBorrowedValue += borrowedValue

    return {
      ...position,
      additionalData: {
        ...position.additionalData,
        collateralInUSD: (position.additionalData.positionInUSD || 0) + borrowedValue
      }
    }
  })

  return {
    ...provider,
    positions,
    collateralInUSD: (provider.positionInUSD || 0) + providerBorrowedValue
  }
}

/** The value borrowed in a DeFi app or position. Zero when it has no loans. */
const getBorrowedValueInUSD = ({
  positionInUSD = 0,
  collateralInUSD = positionInUSD
}: DefiValues): number => collateralInUSD - positionInUSD

export {
  getAssetValue,
  getBorrowedValueInUSD,
  getProviderId,
  isTokenPriceWithinHalfPercent,
  withCollateralValues
}
