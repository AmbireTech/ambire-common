// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'
import networks from '../../../constants/networks'

const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000'

export default function useCoingeckoFetch({
  currentNetwork,
  addToast,
  getCoingeckoPrices,
  getCoingeckoPriceByContract,
  getCoingeckoAssetPlatforms,
  getCoingeckoCoin
}) {
  const fetchCoingeckoPrices = useCallback(
    async (tokens, resolve) => {
      const coingeckoTokensToUpdate = tokens?.map((token) => token.coingeckoId)
      if (!coingeckoTokensToUpdate.length) return null

      try {
        const response = await getCoingeckoPrices(coingeckoTokensToUpdate.join(','))
        if (!response) return null
        resolve && resolve(response)
      } catch (e) {
        // Temporarily dont show this error because of coingecko limitations 10-50 calls per minute
        // addToast(e.message, { error: true })
        resolve && resolve([])
      }
    },
    [getCoingeckoPrices]
  )

  const fetchCoingeckoCoin = useCallback(
    async (token) => {
      if (!token || !token.coingeckoId) return null

      try {
        const response = await getCoingeckoCoin(token.coingeckoId)
        if (!response) return null
        return response
      } catch (e) {
        addToast(e.message, { error: true })
      }
    },
    [getCoingeckoCoin, addToast]
  )

  const fetchCoingeckoAsset = useCallback(async () => {
    const network = networks.find(({ id }) => id === currentNetwork)
    try {
      const response = await getCoingeckoAssetPlatforms()
      if (!response) return null
      const current = response.find((ntw) => ntw.chain_identifier === network?.chainId)
      return current?.id
    } catch (e) {
      addToast(e.message, { error: true })
    }
  }, [addToast, currentNetwork, getCoingeckoAssetPlatforms])

  const fetchCoingeckoPricesByContractAddress = useCallback(
    async (tokens, resolve) => {
      const assetPlatform = await fetchCoingeckoAsset()
      const coingeckoTokensToUpdate = tokens.map((token) => token.address)
      try {
        Promise.all(
          coingeckoTokensToUpdate.map(async (addr) => {
            let isNative = false
            if (NATIVE_ADDRESS === addr) isNative = true

            let contract = false
            if (isNative) {
              if (currentNetwork === 'ethereum') contract = ''
              if (currentNetwork === 'polygon')
                contract = '0x0000000000000000000000000000000000001010'
            } else {
              contract = addr
            }

            // debugger
            try {
              let response = {}
              if (isNative && !contract) {
                const nativeAsset = networks.find(({ id }) => id === currentNetwork)?.nativeAsset
                response = await fetchCoingeckoCoin(nativeAsset)
              } else {
                response = await getCoingeckoPriceByContract(assetPlatform, contract)
              }
              // debugger
              if (!response || response?.error) return null
              return {
                address: isNative ? addr : response?.platforms[assetPlatform],
                tokenImageUrls: response?.image,
                tokenImageUrl: response?.image?.small,
                symbol: response?.symbol.toUpperCase(),
                price: response?.market_data.current_price.usd,
                isHidden: false
              }
            } catch (e) {
              return null
            }
          })
        ).then((res) => {
          const response = res.filter((t) => t)
          resolve({ tokens: response, state: 'coingecko' })
        })
      } catch (e) {
        resolve && resolve({ tokens: {}, state: 'coingecko' })
      }
    },
    [getCoingeckoPriceByContract, fetchCoingeckoAsset, fetchCoingeckoCoin, currentNetwork]
  )

  return {
    fetchCoingeckoPrices,
    fetchCoingeckoPricesByContractAddress
  }
}
