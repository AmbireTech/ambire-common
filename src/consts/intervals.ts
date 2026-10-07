export const UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL = 60000 // 1 minute
export const BRIDGE_STATUS_INTERVAL = 10000 // 10 seconds
// Upon a pending bridge status, the poll interval increases by BRIDGE_STATUS_INTERVAL each
// time, up to this ceiling
export const BRIDGE_STATUS_INTERVAL_CEILING = 60000 // 1 minute
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
export const TRENDING_TOKENS_ACTIVE_UPDATE_INTERVAL = 10 * 60 * 1000 // 10 minutes
export const TRENDING_TOKENS_INACTIVE_UPDATE_INTERVAL = 4 * 60 * 60 * 1000 // 4 hours
export const TRENDING_TOKENS_FAILED_UPDATE_INTERVAL = 60 * 1000 // 1 minute
export const ESTIMATE_UPDATE_INTERVAL = 30000
export const GAS_PRICE_UPDATE_INTERVAL = 12000
export const FETCH_SAFE_TXNS = 3 * 60 * 1000 // 3 minutes
// How often the runner checks whether any scheduled portfolio update is due
export const SCHEDULED_PORTFOLIO_UPDATES_RUNNER_INTERVAL = 20 * 1000 // 20 seconds
// How long a scheduled portfolio update waits before the runner executes it, giving the
// discovery API time to index the defi position changes caused by the transaction
export const SCHEDULED_PORTFOLIO_UPDATE_DELAY = 60 * 1000 // 1 minute
