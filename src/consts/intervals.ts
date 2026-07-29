export const UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL = 60000 // 1 minute
export const BRIDGE_STATUS_INTERVAL = 10000 // 10 seconds
export const ACTIVITY_REFRESH_INTERVAL = 5000 // 5 seconds
export const ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = 2 * 60 * 1000 // 2 minutes
export const INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = 10 * 60 * 1000 // 10 minutes
export const LOCKED_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = 4 * 60 * 60 * 1000 // 4 hours
export const SMART_ACCOUNT_IDENTITY_RETRY_INTERVAL = 300000 // 5 minutes
export const VIEW_ONLY_ACCOUNT_IDENTITY_GET_INTERVAL = 300000 // 5 minutes
export const ACCOUNT_STATE_STAND_BY_INTERVAL = 300000 // 5 minutes
export const NETWORKS_UPDATE_INTERVAL = 8 * 60 * 60 * 1000 // 8 hrs
export const BLACKLIST_UPDATE_INTERVAL = 8 * 60 * 60 * 1000 // 8 hrs
export const PHISHING_INACTIVE_UPDATE_INTERVAL = 6 * 60 * 60 * 1000 // 6 hrs
export const PHISHING_ACTIVE_UPDATE_INTERVAL = 15 * 60 * 1000 // 15 minutes
export const PHISHING_FAILED_TO_GET_UPDATE_INTERVAL = 600000 // 10 minutes
export const ESTIMATE_UPDATE_INTERVAL = 30000
export const GAS_PRICE_UPDATE_INTERVAL = 12000
export const FETCH_SAFE_TXNS = 3 * 60 * 1000 // 3 minutes
/** Hard ceiling for a single network portfolio update (tokens + custom DeFi). */
export const PORTFOLIO_NETWORK_UPDATE_TIMEOUT_MS = 60 * 1000
/** isLoading older than this is treated as stuck — later updates must not skip forever. */
export const PORTFOLIO_LOADING_MAX_AGE_MS = 60 * 1000
/** Timeout for custom on-chain DeFi position fetches (AAVE / Uni V3). */
export const CUSTOM_DEFI_POSITIONS_TIMEOUT_MS = 30 * 1000
/** Timeout for AAVE's pre-deployless reservesLength staticCall. */
export const AAVE_STATIC_CALL_TIMEOUT_MS = 15 * 1000
