import { getPrivacyPoolsChainConfig } from '../../consts/privacyPools'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'

const PRICES_API_URL = 'https://cena.ambire.com/api/v3/simple'

/** The price service's answer: a USD price per asset id or contract address it knows. */
type PricesResponse = { [id: string]: { usd?: number } | undefined }

const NO_PRICES: PricesResponse = {}

/** How a price is keyed: `${chainId}:${tokenAddress}`, the address lowercase, native as zero. */
export const getPrivacyPoolsPriceKey = (chainId: string | bigint, tokenAddress: string) =>
  `${chainId.toString()}:${tokenAddress.toLowerCase()}`

/**
 * USD prices of every asset the pools accept on the given networks, from the same price service
 * the portfolio uses.
 *
 * Every accepted asset is asked for, not only those the account holds, so the request says nothing
 * about what a Privacy Pools account contains - the list is the same for everyone. An asset the
 * service does not price is simply left out, as are test networks' assets, which it does not know.
 */
export const fetchPrivacyPoolsPrices = async ({
  fetch,
  networks
}: {
  fetch: Fetch
  networks: Network[]
}): Promise<{ [priceKey: string]: number }> => {
  const prices: { [priceKey: string]: number } = {}

  await Promise.all(
    networks.map(async (network) => {
      const config = getPrivacyPoolsChainConfig(network.chainId)
      if (!config) return

      const nativeAsset = config.assets.find(({ isNative }) => isNative)
      const tokens = config.assets.filter(({ isNative }) => !isNative)

      const [nativePrices, tokenPrices] = await Promise.all([
        nativeAsset && network.nativeAssetId
          ? fetchJson(
              fetch,
              `${PRICES_API_URL}/price?ids=${network.nativeAssetId}&vs_currencies=usd`
            )
          : NO_PRICES,
        tokens.length && network.platformId
          ? fetchJson(
              fetch,
              `${PRICES_API_URL}/token_price/${network.platformId}?contract_addresses=${tokens
                .map(({ address }) => address.toLowerCase())
                .join(',')}&vs_currencies=usd`
            )
          : NO_PRICES
      ])

      const nativePrice = nativePrices[network.nativeAssetId]?.usd
      if (nativeAsset && typeof nativePrice === 'number')
        prices[getPrivacyPoolsPriceKey(network.chainId, nativeAsset.address)] = nativePrice

      tokens.forEach(({ address }) => {
        const price = tokenPrices[address.toLowerCase()]?.usd
        if (typeof price === 'number')
          prices[getPrivacyPoolsPriceKey(network.chainId, address)] = price
      })
    })
  )

  return prices
}

const fetchJson = async (fetch: Fetch, url: string): Promise<PricesResponse> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`privacyPools: price request failed with ${response.status}`)

  return response.json()
}
