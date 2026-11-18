import { getRpcTokenPriceConfig } from '../../consts/rpcTokenPrices'
import { Network } from '../../interfaces/network'

/**
 * Whether the network's tokens can get a price from the source the user picked: our price API
 * (cena) when `isTokenPricesEnabled`, or the network's RPC otherwise. When it's false, the
 * network's balance is unknown rather than zero.
 */
export const canPriceNetwork = (network: Network, isTokenPricesEnabled: boolean): boolean => {
  // Without a CoinGecko platform cena has nothing to look the tokens up by
  if (isTokenPricesEnabled) return !!network.platformId

  return !!getRpcTokenPriceConfig(network.chainId)
}
