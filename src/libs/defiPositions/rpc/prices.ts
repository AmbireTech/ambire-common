import { Price } from '../../../interfaces/assets'
import { Network } from '../../../interfaces/network'
import { ITokenPricesController } from '../../../interfaces/tokenPrices'
import { getUsdPriceIn } from '../../portfolio/helpers'
import { TokenDataCacheValue } from '../../portfolio/interfaces'
import { getAssetValue, getProviderId } from '../helpers'
import { AssetType, PositionAsset, PositionsByProvider } from '../types'

// This function is separated to its own file to allow mocking in the
// portfolio controller test. If the function is in the same file as
// the logic that reads the positions from the chain (`rpc/index.ts`), it's referenced directly from the
// file scope and mocking doesn't work.

// Aave positions are priced by the Aave oracle in the corresponding lib
const getIsPricedByProvider = (providerName: string) => getProviderId(providerName).includes('aave')

const getIsMissingPrice = (asset: PositionAsset): asset is PositionAsset & { address: string } =>
  !!asset.address && !asset.priceIn

/**
 * The USD price of an asset, from its own price or, when it has none, from the price of the
 * token its `priceFallback` converts it to.
 */
const getUsdPriceInWithFallback = (
  tokenData: Map<string, TokenDataCacheValue>,
  asset: PositionAsset & { address: string }
): Price | undefined => {
  const priceIn = getUsdPriceIn(tokenData, asset.address)
  if (priceIn || !asset.priceFallback || asset.amount === 0n) return priceIn

  const fallbackPriceIn = getUsdPriceIn(tokenData, asset.priceFallback.address)
  if (!fallbackPriceIn) return undefined

  const value = getAssetValue(asset.priceFallback.amount, asset.priceFallback.decimals, [
    fallbackPriceIn
  ])
  if (value === undefined) return undefined

  return {
    baseCurrency: 'usd',
    price: value / (Number(asset.amount) / 10 ** asset.decimals)
  }
}

/**
 * What an asset adds to the value of its position. A borrowed asset is a debt, so it's
 * subtracted, like in the positions of the API and Aave (see `positionInUSD`). An asset
 * without a price adds nothing.
 */
const getValueInPosition = (asset: PositionAsset): number => {
  const value = asset.value || 0

  return asset.type === AssetType.Borrow ? -value : value
}

/**
 * Prices the assets of the provided positions that have no price yet - such as Uniswap V3
 * positions read from the chain that Debank doesn't know about (yet) - through the token
 * prices controller, and updates their values. Prices that are already set (e.g. by Debank) are
 * never replaced, and nothing is requested when no asset is missing a price. An asset the token
 * prices controller can't price is valued through its `priceFallback`, if it has one.
 * A position without a value of its own gets the value of its assets, with the borrowed ones
 * subtracted.
 */
export async function updatePositionsByProviderAssetPrices(
  tokenPrices: ITokenPricesController,
  {
    network,
    positionsByProvider
  }: {
    network: Network
    positionsByProvider: PositionsByProvider[]
  }
): Promise<{ positionsByProvider: PositionsByProvider[]; error: Error | null }> {
  const addressesMissingAPrice = positionsByProvider
    .filter(({ providerName }) => !getIsPricedByProvider(providerName))
    .flatMap(({ positions }) => positions.flatMap(({ assets }) => assets))
    .filter(getIsMissingPrice)
    .flatMap(({ address, priceFallback }) =>
      priceFallback ? [address, priceFallback.address] : [address]
    )

  if (!addressesMissingAPrice.length) return { positionsByProvider, error: null }

  const { tokenData, error } = await tokenPrices.getTokenData({
    network,
    tokenAddresses: addressesMissingAPrice
  })

  const withFetchedPrice = (asset: PositionAsset): PositionAsset => {
    if (!getIsMissingPrice(asset)) return asset

    const priceIn = getUsdPriceInWithFallback(tokenData, asset)
    if (!priceIn) return asset

    return {
      ...asset,
      priceIn,
      value: getAssetValue(asset.amount, asset.decimals, [priceIn]) || 0
    }
  }

  const positionsByProviderWithPrices = positionsByProvider.map((posByProvider) => {
    if (getIsPricedByProvider(posByProvider.providerName)) return posByProvider

    const updatedPositions = posByProvider.positions.map((position) => {
      const hasPositionValue = !!position.additionalData.positionInUSD
      let positionInUSD = position.additionalData.positionInUSD || 0

      const updatedAssets = position.assets.map((asset) => {
        const pricedAsset = withFetchedPrice(asset)

        if (!hasPositionValue) {
          positionInUSD += getValueInPosition(pricedAsset)
        }

        return pricedAsset
      })

      return {
        ...position,
        assets: updatedAssets,
        additionalData: { ...position.additionalData, positionInUSD }
      }
    })

    let positionInUSD = posByProvider.positionInUSD

    // Already set in the corresponding lib
    if (!positionInUSD) {
      positionInUSD = updatedPositions.reduce((prevPositionValue, position) => {
        return prevPositionValue + (position.additionalData.positionInUSD || 0)
      }, 0)
    }

    return { ...posByProvider, positions: updatedPositions, positionInUSD }
  })

  return { positionsByProvider: positionsByProviderWithPrices, error }
}
