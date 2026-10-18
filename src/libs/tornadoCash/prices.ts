import { TORNADO_CASH_POOLS } from '../../consts/tornadoCash'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'

const PRICES_API_URL = 'https://cena.ambire.com/api/v3/simple'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

type PricesResponse = { [id: string]: { usd?: number } | undefined }

const fetchJson = async (fetch: Fetch, url: string): Promise<PricesResponse> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`tornadoCash: prices request failed with ${response.status}`)

  return response.json()
}

/**
 * USD prices of every asset the pools hold, keyed by the lowercase asset address (zero for ETH).
 * Asks for all of them, not only the held ones, so the request reveals nothing about the account.
 * Unpriced assets are left out.
 */
export const fetchTornadoCashPrices = async ({
  fetch,
  network
}: {
  fetch: Fetch
  network: Network
}): Promise<{ [assetAddress: string]: number }> => {
  const tokenAddresses = [
    ...new Set(
      TORNADO_CASH_POOLS.map(({ assetAddress }) => assetAddress.toLowerCase()).filter(
        (assetAddress) => assetAddress !== ZERO_ADDRESS
      )
    )
  ]

  const [nativePrices, tokenPrices] = await Promise.all([
    network.nativeAssetId
      ? fetchJson(fetch, `${PRICES_API_URL}/price?ids=${network.nativeAssetId}&vs_currencies=usd`)
      : {},
    network.platformId
      ? fetchJson(
          fetch,
          `${PRICES_API_URL}/token_price/${network.platformId}?contract_addresses=${tokenAddresses.join(
            ','
          )}&vs_currencies=usd`
        )
      : {}
  ])

  const prices: { [assetAddress: string]: number } = {}
  const nativePrice = (nativePrices as PricesResponse)[network.nativeAssetId]?.usd
  if (typeof nativePrice === 'number') prices[ZERO_ADDRESS] = nativePrice

  tokenAddresses.forEach((tokenAddress) => {
    const price = (tokenPrices as PricesResponse)[tokenAddress]?.usd
    if (typeof price === 'number') prices[tokenAddress] = price
  })

  return prices
}
