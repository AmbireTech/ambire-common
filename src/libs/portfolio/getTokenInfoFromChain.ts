import {
  filterStaticBlacklistedAddrs,
  isBlacklistedAsset,
  prepareBlacklistPatterns,
  STATIC_BLACKLIST
} from './blacklist'
import type { TokenError, TokenResult } from './interfaces'

type GetTokensInfo = (chainId: bigint, tokenAddrs: string[]) => Promise<[TokenError, TokenResult][]>

const STATIC_BLACKLIST_PATTERNS = prepareBlacklistPatterns(STATIC_BLACKLIST.blacklistBySymbols)

/**
 * Reads the name, symbol and decimals of a token from the chain, through the RPC of the user.
 * Nothing is sent to an Ambire service, unlike a lookup in an API.
 *
 * Returns null if the address is not a token (same rule as the portfolio: no error and a
 * symbol), or if the token is on the static blacklist (by address, or by symbol and name).
 * The data comes from the token contract itself, so it can say anything about the token.
 */
export const getTokenInfoFromChain = async ({
  getTokensInfo,
  chainId,
  address
}: {
  getTokensInfo: GetTokensInfo
  chainId: bigint
  address: string
}): Promise<TokenResult | null> => {
  if (!filterStaticBlacklistedAddrs([address], chainId).length) return null

  const [tokenWithError] = await getTokensInfo(chainId, [address])
  if (!tokenWithError) return null

  const [error, token] = tokenWithError
  if (error !== '0x' || !token.symbol) return null

  const isBlacklisted = isBlacklistedAsset({
    symbol: token.symbol,
    name: token.name,
    patterns: STATIC_BLACKLIST_PATTERNS
  })

  return isBlacklisted ? null : token
}
