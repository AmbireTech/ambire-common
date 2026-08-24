import { ToTokenMarketDataStatus } from '../interfaces/swapAndBridge'

export const HARD_CODED_CURRENCY = 'usd'

// The amount threshold in % used by sortSwapAndBridgeRoutes. If the output value
// difference between two routes is below this, the sort falls back to service time
export const ROUTE_SORT_AMOUNT_THRESHOLD_PERCENT = 1.2

export const CONVERSION_PRECISION = 16
export const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION)

export const NETWORK_MISMATCH_MESSAGE =
  'Swap & Bridge network configuration mismatch. Please try again or contact Ambire support.'

// For performance reasons, limit the max number of tokens in the to token list
export const TO_TOKEN_LIST_LIMIT = 100
export const TO_TOKEN_PRICE_TIMEOUT_MS = 4000

export const SUPPORTED_CHAINS_CACHE_THRESHOLD = 1000 * 60 * 60 * 24 // 1 day
export const TO_TOKEN_LIST_CACHE_THRESHOLD = 1000 * 60 * 60 * 4 // 4 hours

// Market data (24h change, market cap) goes stale fast, so a short threshold. Displaying
// a day-old price movement next to a token the user is about to receive would be misleading.
export const MARKET_DATA_THRESHOLD = 1000 * 60 * 10 // 10 minutes
// Many of the tokens in the service provider lists are not tracked by our price API at all.
// Their absence is effectively permanent, so don't keep asking for them.
export const MARKET_DATA_NOT_FOUND_THRESHOLD = 1000 * 60 * 60 * 24 // 1 day
export const MARKET_DATA_FAIL_THRESHOLD = 1000 * 60 * 2 // 2 minutes
// Frees records left in a loading state by a request that can no longer complete, for
// instance because the background got suspended mid-flight. Without it such records
// would never be requested again and their tokens would load forever.
export const MARKET_DATA_LOADING_DEADLINE = 1000 * 30 // 30 seconds

export const MARKET_DATA_THRESHOLD_BY_STATUS: { [status in ToTokenMarketDataStatus]: number } = {
  DONE: MARKET_DATA_THRESHOLD,
  NOT_FOUND: MARKET_DATA_NOT_FOUND_THRESHOLD,
  FAIL: MARKET_DATA_FAIL_THRESHOLD,
  LOADING: MARKET_DATA_LOADING_DEADLINE
}
