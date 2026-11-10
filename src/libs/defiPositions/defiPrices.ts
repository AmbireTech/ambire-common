import { Network } from '../../interfaces/network'
import { ITokenPricesController } from '../../interfaces/tokenPrices'
import { getTokenDataCacheKey } from '../portfolio/helpers'
import { TokenDataCacheValue } from '../portfolio/interfaces'
import { getAssetValue, getProviderId } from './helpers'
import { PositionAsset, PositionsByProvider } from './types'

// This function is separated to its own file to allow mocking in the
// portfolio controller test. If the function is in the same file as
// the main defiPositions logic, it's being referenced directly from the
// file scope and mocking doesn't work.

// Aave positions are priced by the Aave oracle in the corresponding lib
const getIsPricedByProvider = (providerName: string) => getProviderId(providerName).includes('aave')

const getIsMissingPrice = (asset: PositionAsset): asset is PositionAsset & { address: string } =>
  !!asset.address && !asset.priceIn

/**
 * Prices the assets of the provided positions that have no price yet - such as Uniswap V3
 * positions read from the chain that Debank doesn't know about (yet) - through the token
 * prices controller, and updates their values. Prices that are already set (e.g. by Debank) are
 * never replaced, and nothing is requested when no asset is missing a price.
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
    .map(({ address }) => address)

  if (!addressesMissingAPrice.length) return { positionsByProvider, error: null }

  const { tokenData, error } = await tokenPrices.getTokenData({
    network,
    tokenAddresses: addressesMissingAPrice
  })

  const withFetchedPrice = (asset: PositionAsset): PositionAsset => {
    if (!getIsMissingPrice(asset)) return asset

    const assetTokenData: TokenDataCacheValue | undefined = tokenData.get(
      getTokenDataCacheKey(asset.address)
    )
    const priceIn = assetTokenData?.priceIn.find(({ baseCurrency }) => baseCurrency === 'usd')
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
          positionInUSD += pricedAsset.value || 0
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
