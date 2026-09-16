import { Platform } from '../interfaces/platform'

// Different invictus requests can hit different providers so we allow a few blocks of difference
export const DEFAULT_STALE_RPC_BLOCK_THRESHOLD = 10

// Ethereum blocks are ~12s apart, so every tolerated block is a long stretch of stale data
export const ETHEREUM_STALE_RPC_BLOCK_THRESHOLD = 2

/**
 * How long a request to our own APIs is given. Enough for the token prices, which come back in
 * a few hundred milliseconds - see `getDiscoveryTimeout` for the one request this is too tight
 * for. A timed out request is retried rather than given a longer budget on every platform, see
 * `shouldRetryAmbireApiRequest`.
 */
export const AMBIRE_API_TIMEOUT = 3000

/**
 * The discovery request is the odd one out: it carries the DeFi positions and the asset hints of
 * every network at once, so its response is measured in hundreds of kilobytes rather than a few,
 * and it takes seconds rather than milliseconds. Mobile gets a longer budget for it, because a
 * cold start has nothing cached and the positions it gives up on are gone until the next update.
 * Not longer still, since the tokens are only fetched once discovery answers, so every extra
 * second is a second of blank network.
 */
export const MOBILE_DISCOVERY_TIMEOUT = 6000

/** How long the portfolio discovery request is given on the current platform. */
export const getDiscoveryTimeout = (platform: Platform): number =>
  platform.startsWith('mobile') ? MOBILE_DISCOVERY_TIMEOUT : AMBIRE_API_TIMEOUT

/**
 * Whether a timed out request to our APIs is worth sending once more. Only on mobile, where the
 * portfolio has nothing cached to fall back on after a cold start, so a request that is given up
 * on leaves the balance incomplete until the next update, minutes later.
 */
export const shouldRetryAmbireApiRequest = (platform: Platform): boolean =>
  platform.startsWith('mobile')
