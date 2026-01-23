import { fetchWithTimeout } from '../../utils/fetch'
import { getAssetValue, getProviderId } from './helpers'
import { PositionsByProvider } from './types'

// This function is separated to its own file to allow mocking in the
// portfolio controller test. If the function is in the same file as
// the main defiPositions logic, it's being referenced directly from the
// file scope and mocking doesn't work.

/**
 * Fetches the USD prices for the assets in the provided positions
 * using cena and updates the positions with the fetched prices and values.
 */
export async function updatePositionsByProviderAssetPrices(
  fetch: Function,
  positionsByProvider: PositionsByProvider[],
  platformId: string | null = null
) {
  // If we can't determine the Gecko platform ID, we shouldn't make a request to price (cena.ambire.com)
  // since it would return nothing.
  // This can happen when adding a custom network that doesn't have a CoinGecko platform ID.
  if (!platformId) return null

  const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)

  const addresses: string[] = []

  positionsByProvider.forEach((providerPos) => {
    providerPos.positions.forEach((p) => {
      p.assets.forEach((a) => {
        addresses.push(a.address)
      })
    })
  })

  const cenaUrl = `https://cena.ambire.com/api/v3/simple/token_price/${platformId}?contract_addresses=${dedup(
    addresses
  ).join('%2C')}&vs_currencies=usd`

  const resp = await fetchWithTimeout(fetch, cenaUrl, {}, 3000)
  const body = await resp.json()
  if (resp.status !== 200) throw body
  // eslint-disable-next-line no-prototype-builtins
  if (body.hasOwnProperty('message')) throw body
  // eslint-disable-next-line no-prototype-builtins
  if (body.hasOwnProperty('error')) throw body

  const positionsByProviderWithPrices = positionsByProvider.map((posByProvider) => {
    if (getProviderId(posByProvider.providerName).includes('aave')) return posByProvider

    const updatedPositions = posByProvider.positions.map((position) => {
      let positionInUSD = position.additionalData.positionInUSD || 0

      const updatedAssets = position.assets.map((asset) => {
        const priceData = body[asset.address.toLowerCase()]
        if (!priceData) return asset

        const priceIn = Object.entries(priceData).map(([currency, price]) => ({
          baseCurrency: currency,
          price: price as number
        }))

        const value = getAssetValue(asset.amount, asset.decimals, priceIn) || 0

        if (!position.additionalData.positionInUSD) {
          positionInUSD += value
        }

        return { ...asset, value, priceIn: priceIn[0]! }
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

  return positionsByProviderWithPrices
}
