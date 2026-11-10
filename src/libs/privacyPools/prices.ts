import { formatUnits } from 'ethers'

import { getPrivacyPoolsChainConfig } from '../../consts/privacyPools'
import { Network } from '../../interfaces/network'
import { PrivacyPoolsTokenBalance } from '../../interfaces/privacyPools'
import { TokenPricesService } from '../../services/tokenPrices/tokenPrices'
import { getTokenDataCacheKey } from '../portfolio/helpers'

/** How a price is keyed: `${chainId}:${tokenAddress}`, the address lowercase, native as zero. */
export const getPrivacyPoolsPriceKey = (chainId: string | bigint, tokenAddress: string) =>
  `${chainId.toString()}:${tokenAddress.toLowerCase()}`

/**
 * What the account will hold of a token once what is on its way shows in its notes. Not below
 * zero, as a sync that is ahead of what was expected must not show a negative balance.
 */
export const getPrivacyPoolsProjectedAmount = ({
  totalAmount,
  simulationAmount
}: Pick<PrivacyPoolsTokenBalance, 'totalAmount' | 'simulationAmount'>): bigint => {
  const projectedAmount = totalAmount + simulationAmount

  return projectedAmount > 0n ? projectedAmount : 0n
}

/**
 * USD value per chain of the balances, the pending part included, as the account will hold it
 * once what is on its way shows - see `getPrivacyPoolsProjectedAmount`. An unpriced
 * token adds nothing rather than making the chain's value unknown.
 */
export const getPrivacyPoolsValuePerChain = (
  balances: { [chainId: string]: PrivacyPoolsTokenBalance[] },
  prices: { [priceKey: string]: number }
): { [chainId: string]: number } =>
  Object.fromEntries(
    Object.entries(balances).map(([chainId, chainBalances]) => [
      chainId,
      chainBalances.reduce((total, balance) => {
        const price = prices[getPrivacyPoolsPriceKey(chainId, balance.tokenAddress)]
        if (price === undefined) return total

        return (
          total +
          Number(formatUnits(getPrivacyPoolsProjectedAmount(balance), balance.decimals)) * price
        )
      }, 0)
    ])
  )

/**
 * USD prices of every asset the pools accept on the given networks. Asks for all of them, not only
 * the held ones, so the request reveals nothing about the account. Unpriced assets are left out.
 *
 * They come through the token prices service, which sends these assets with every request on the
 * networks the pools are on, so they are usually answered from its cache without a request.
 * Throws if a price request fails, so that the previous prices are kept.
 */
export const fetchPrivacyPoolsPrices = async ({
  tokenPrices,
  networks,
  maxAgeMs
}: {
  tokenPrices: TokenPricesService
  networks: Network[]
  maxAgeMs: number
}): Promise<{ [priceKey: string]: number }> => {
  const prices: { [priceKey: string]: number } = {}

  await Promise.all(
    networks.map(async (network) => {
      const config = getPrivacyPoolsChainConfig(network.chainId)
      if (!config) return

      const { tokenData, error } = await tokenPrices.getTokenData({
        network,
        tokenAddresses: config.assets.map(({ address }) => address),
        maxAgeMs
      })
      if (error) throw error

      config.assets.forEach(({ address }) => {
        const price = tokenData
          .get(getTokenDataCacheKey(address))
          ?.priceIn.find(({ baseCurrency }) => baseCurrency === 'usd')?.price

        if (typeof price === 'number')
          prices[getPrivacyPoolsPriceKey(network.chainId, address)] = price
      })
    })
  )

  return prices
}
