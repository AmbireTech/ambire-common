import {
  filterStaticBlacklistedAddrs,
  isBlacklistedAsset,
  prepareBlacklistPatterns,
  STATIC_BLACKLIST
} from './blacklist'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getTokenInfo, TokenInfo } from './getTokenInfo'

const STATIC_BLACKLIST_PATTERNS = prepareBlacklistPatterns(STATIC_BLACKLIST.blacklistBySymbols)

/**
 * Reads the name, symbol and decimals of a token from the chain, through the RPC of the user.
 * Nothing is sent to an Ambire service, unlike a lookup in an API.
 *
 * Returns null if the address is not a token (it has no symbol), or if the token is on the
 * static blacklist (by address, or by symbol and name).
 * The data comes from the token contract itself, so it can say anything about the token.
 */
export const getTokenMetaViaRPC = async ({
  provider,
  network,
  address
}: {
  provider: RPCProvider
  network: Network
  address: string
}): Promise<TokenInfo | null> => {
  if (!filterStaticBlacklistedAddrs([address], network.chainId).length) return null

  const token = await getTokenInfo({ provider, network, address })
  if (!token?.symbol) return null

  const isBlacklisted = isBlacklistedAsset({
    symbol: token.symbol,
    name: token.name,
    patterns: STATIC_BLACKLIST_PATTERNS
  })

  return isBlacklisted ? null : token
}
