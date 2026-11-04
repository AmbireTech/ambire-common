// The intervals of recurring controller work - polling, background updates and refreshes that
// repeat while the app runs. A one-off wait or timeout (e.g. before a single retry) doesn't
// belong here; keep it as a constant next to the code that uses it.
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
// Longer than the 60s timeout of the list download, so that a domain check waits for its outcome
export const PHISHING_LIST_WAIT_TIMEOUT = 70 * 1000 // 70 seconds
export const TRENDING_TOKENS_ACTIVE_UPDATE_INTERVAL = 10 * 60 * 1000 // 10 minutes
export const TRENDING_TOKENS_INACTIVE_UPDATE_INTERVAL = 4 * 60 * 60 * 1000 // 4 hours
export const TRENDING_TOKENS_FAILED_UPDATE_INTERVAL = 60 * 1000 // 1 minute
export const ESTIMATE_UPDATE_INTERVAL = 30000
export const GAS_PRICE_UPDATE_INTERVAL = 12000
export const FETCH_SAFE_TXNS = 3 * 60 * 1000 // 3 minutes
// How old the pending counts of the Safes that are not selected may get before an app open or
// focus refreshes them
export const FETCH_OTHER_SAFES_PENDING = 15 * 60 * 1000 // 15 minutes
/**
 * How often the signed Safe txns and messages waiting for more owners are checked while the
 * wallet is open. The two checks are a second apart so their requests don't go out together.
 */
export const SAFE_TXNS_RESOLVE_ACTIVE_INTERVAL = 10 * 1000 // 10 seconds
export const SAFE_MESSAGES_RESOLVE_ACTIVE_INTERVAL = 11 * 1000 // 11 seconds
/**
 * How often the same checks run while no wallet window is open. They don't stop, as a dapp
 * may still be waiting for the other owners' signatures of a Safe message or txn.
 */
export const SAFE_RESOLVE_INACTIVE_INTERVAL = 60 * 1000 // 1 minute
/** How many checks in a row may find nothing new before the checks start to slow down */
export const SAFE_RESOLVE_UNCHANGED_CHECKS_BEFORE_BACKOFF = 3
/** The slowest the Safe checks get while nothing changes, with and without a wallet window */
export const SAFE_RESOLVE_MAX_ACTIVE_INTERVAL = 30 * 1000 // 30 seconds
export const SAFE_RESOLVE_MAX_INACTIVE_INTERVAL = 5 * 60 * 1000 // 5 minutes
// How often the runner checks whether any scheduled portfolio update is due
export const SCHEDULED_PORTFOLIO_UPDATES_RUNNER_INTERVAL = 20 * 1000 // 20 seconds
// How long a scheduled portfolio update waits before the runner executes it, giving the
// discovery API time to index the defi position changes caused by the transaction
export const SCHEDULED_PORTFOLIO_UPDATE_DELAY = 60 * 1000 // 1 minute
