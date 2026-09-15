import { Platform } from '../interfaces/platform'

// Different invictus requests can hit different providers so we allow a few blocks of difference
export const DEFAULT_STALE_RPC_BLOCK_THRESHOLD = 10

// Ethereum blocks are ~12s apart, so every tolerated block is a long stretch of stale data
export const ETHEREUM_STALE_RPC_BLOCK_THRESHOLD = 2

/**
 * How long a request to our own APIs (portfolio discovery, token prices) is given. The same on
 * every platform: a longer budget only helps a response that is slow yet still on its way, and
 * discovery is awaited before the tokens are fetched, so waiting longer keeps the whole network
 * blank for longer. A timed out request is retried instead - see `shouldRetryAmbireApiRequest`.
 */
export const AMBIRE_API_TIMEOUT = 3000

/**
 * Whether a timed out request to our APIs is worth sending once more. Only on mobile, where the
 * portfolio has nothing cached to fall back on after a cold start, so a request that is given up
 * on leaves the balance incomplete until the next update, minutes later.
 */
export const shouldRetryAmbireApiRequest = (platform: Platform): boolean =>
  platform.startsWith('mobile')
