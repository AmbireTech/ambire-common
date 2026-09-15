import { Platform } from '../interfaces/platform'

// Different invictus requests can hit different providers so we allow a few blocks of difference
export const DEFAULT_STALE_RPC_BLOCK_THRESHOLD = 10

// Ethereum blocks are ~12s apart, so every tolerated block is a long stretch of stale data
export const ETHEREUM_STALE_RPC_BLOCK_THRESHOLD = 2

// Requests to our own APIs get a bigger budget on mobile. The limit is not really about network
// latency there - the timer and the response share one JS thread, so at cold start it ends up
// measuring how busy that thread is, and a timed out request silently costs the user data.
export const AMBIRE_API_TIMEOUT = 3000
export const MOBILE_AMBIRE_API_TIMEOUT = 10000

const isMobilePlatform = (platform: Platform): boolean => platform.startsWith('mobile')

/** The request budget for our APIs (portfolio discovery, token prices) on the given platform. */
export const getAmbireApiTimeout = (platform: Platform): number =>
  isMobilePlatform(platform) ? MOBILE_AMBIRE_API_TIMEOUT : AMBIRE_API_TIMEOUT

/**
 * Whether a timed out request to our APIs is worth sending once more. Only on mobile, where the
 * portfolio would otherwise show incomplete data until its next update, minutes later.
 */
export const shouldRetryAmbireApiRequest = (platform: Platform): boolean =>
  isMobilePlatform(platform)
