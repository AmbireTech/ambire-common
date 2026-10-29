import {
  filterStaticBlacklistedAddrs,
  isBlacklistedAsset,
  prepareBlacklistPatterns,
  STATIC_BLACKLIST
} from './blacklist'
import type { TokenInfo } from './getTokenInfo'

type GetTokenInfo = (chainId: bigint, address: string) => Promise<TokenInfo | null>

const STATIC_BLACKLIST_PATTERNS = prepareBlacklistPatterns(STATIC_BLACKLIST.blacklistBySymbols)

/**
 * Reads the name, symbol and decimals of a token from the chain, through the RPC of the user.
 * Nothing is sent to an Ambire service, unlike a lookup in an API.
 *
 * Returns null if the address is not a token (it has no symbol), or if the token is on the
 * static blacklist (by address, or by symbol and name).
 * The data comes from the token contract itself, so it can say anything about the token.
 */
export const getTokenInfoFromChain = async ({
  getTokenInfo,
  chainId,
  address
}: {
  getTokenInfo: GetTokenInfo
  chainId: bigint
  address: string
}): Promise<TokenInfo | null> => {
  if (!filterStaticBlacklistedAddrs([address], chainId).length) return null

  const token = await getTokenInfo(chainId, address)
  if (!token?.symbol) return null

  const isBlacklisted = isBlacklistedAsset({
    symbol: token.symbol,
    name: token.name,
    patterns: STATIC_BLACKLIST_PATTERNS
  })

  return isBlacklisted ? null : token
}
