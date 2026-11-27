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

/**
 * Whether the network's RPC can price every token and not only the native one: it has both the
 * native token's USD feed (Chainlink's) and 1inch's spot price aggregator
 */
export const canRpcPriceEveryToken = (chainId: bigint): boolean =>
  !!getRpcTokenPriceConfig(chainId)?.spotPrices

/**
 * Whether a token without a USD price can be taken as one that has no market (most likely a scam
 * token), rather than one that just wasn't priced. Such tokens are collapsed into the "Other"
 * tokens of the dashboard and left out of the tokens to swap or bridge.
 */
export const isMissingPriceMeaningful = (
  chainId: bigint,
  isTokenPricesEnabled: boolean,
  isAutoDiscoveryEnabled: boolean
): boolean => {
  if (isTokenPricesEnabled) return true

  // When token prices are disabled the prices come from the network's RPC. With auto discovery
  // enabled, tokens without a price cannot be classified as lower-value
  if (isAutoDiscoveryEnabled) return false

  // Without auto discovery the tokens the account receives are learned without checking that they
  // have a price, so scam tokens show up too. When the network has both price oracles and the
  // token still has no price, it has no pool with enough liquidity. Otherwise the missing price
  // says nothing about the token, so it isn't classified as lower-value.
  return canRpcPriceEveryToken(chainId)
}
