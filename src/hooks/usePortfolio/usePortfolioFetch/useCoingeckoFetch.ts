// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'
import networks, { coingeckoNets } from '../../../constants/networks'

export default function useCoingeckoFetch({
  currentNetwork,
  addToast,
  getCoingeckoPrices,
  getCoingeckoPriceByContract,
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

  const fetchCoingeckoPricesByContractAddress = useCallback(
    async (tokens, resolve) => {
      const coingeckoTokensToUpdate = tokens.map((token) => token.address)
      try {
        Promise.all(
          coingeckoTokensToUpdate.map(async (addr) => {
            const nativeAsset = networks.find(({ id }) => id === currentNetwork)?.nativeAsset
            const isNative = addr === nativeAsset.address
            const contract = addr

            try {
              let response = {}
              if (isNative) {
                response = await fetchCoingeckoCoin(nativeAsset)
              } else {
                response = await getCoingeckoPriceByContract(
                  coingeckoNets[currentNetwork],
                  contract
                )
              }

              if (!response || response?.error) return null
              return {
                address: isNative ? addr : response?.platforms[coingeckoNets[currentNetwork]],
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
        resolve && resolve({ tokens: [], state: 'coingecko' })
      }
    },
    [getCoingeckoPriceByContract, fetchCoingeckoCoin, currentNetwork]
  )

  return {
    fetchCoingeckoPrices,
    fetchCoingeckoPricesByContractAddress
  }
}
