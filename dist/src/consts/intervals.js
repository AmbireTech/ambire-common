"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEDULED_PORTFOLIO_UPDATE_DELAY = exports.SCHEDULED_PORTFOLIO_UPDATES_RUNNER_INTERVAL = exports.FETCH_OTHER_SAFES_PENDING = exports.FETCH_SAFE_TXNS = exports.GAS_PRICE_UPDATE_INTERVAL = exports.ESTIMATE_UPDATE_INTERVAL = exports.TRENDING_TOKENS_FAILED_UPDATE_INTERVAL = exports.TRENDING_TOKENS_INACTIVE_UPDATE_INTERVAL = exports.TRENDING_TOKENS_ACTIVE_UPDATE_INTERVAL = exports.PHISHING_LIST_WAIT_TIMEOUT = exports.PHISHING_FAILED_TO_GET_UPDATE_INTERVAL = exports.PHISHING_ACTIVE_UPDATE_INTERVAL = exports.PHISHING_INACTIVE_UPDATE_INTERVAL = exports.BLACKLIST_UPDATE_INTERVAL = exports.NETWORKS_UPDATE_INTERVAL = exports.ACCOUNT_STATE_STAND_BY_INTERVAL = exports.VIEW_ONLY_ACCOUNT_IDENTITY_GET_INTERVAL = exports.SMART_ACCOUNT_IDENTITY_RETRY_INTERVAL = exports.LOCKED_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = exports.INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = exports.ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = exports.ACTIVITY_REFRESH_INTERVAL = exports.BRIDGE_STATUS_INTERVAL_CEILING = exports.BRIDGE_STATUS_INTERVAL = exports.UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL = void 0;
exports.UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL = 60000; // 1 minute
exports.BRIDGE_STATUS_INTERVAL = 10000; // 10 seconds
// Upon a pending bridge status, the poll interval increases by BRIDGE_STATUS_INTERVAL each
// time, up to this ceiling
exports.BRIDGE_STATUS_INTERVAL_CEILING = 60000; // 1 minute
exports.ACTIVITY_REFRESH_INTERVAL = 5000; // 5 seconds
exports.ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = 2 * 60 * 1000; // 2 minutes
exports.INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = 10 * 60 * 1000; // 10 minutes
exports.LOCKED_EXTENSION_PORTFOLIO_UPDATE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
exports.SMART_ACCOUNT_IDENTITY_RETRY_INTERVAL = 300000; // 5 minutes
exports.VIEW_ONLY_ACCOUNT_IDENTITY_GET_INTERVAL = 300000; // 5 minutes
exports.ACCOUNT_STATE_STAND_BY_INTERVAL = 300000; // 5 minutes
exports.NETWORKS_UPDATE_INTERVAL = 8 * 60 * 60 * 1000; // 8 hrs
exports.BLACKLIST_UPDATE_INTERVAL = 8 * 60 * 60 * 1000; // 8 hrs
exports.PHISHING_INACTIVE_UPDATE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hrs
exports.PHISHING_ACTIVE_UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutes
exports.PHISHING_FAILED_TO_GET_UPDATE_INTERVAL = 600000; // 10 minutes
// Longer than the 60s timeout of the list download, so that a domain check waits for its outcome
exports.PHISHING_LIST_WAIT_TIMEOUT = 70 * 1000; // 70 seconds
exports.TRENDING_TOKENS_ACTIVE_UPDATE_INTERVAL = 10 * 60 * 1000; // 10 minutes
exports.TRENDING_TOKENS_INACTIVE_UPDATE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
exports.TRENDING_TOKENS_FAILED_UPDATE_INTERVAL = 60 * 1000; // 1 minute
exports.ESTIMATE_UPDATE_INTERVAL = 30000;
exports.GAS_PRICE_UPDATE_INTERVAL = 12000;
exports.FETCH_SAFE_TXNS = 3 * 60 * 1000; // 3 minutes
// How old the pending counts of the Safes that are not selected may get before an app open or
// focus refreshes them
exports.FETCH_OTHER_SAFES_PENDING = 15 * 60 * 1000; // 15 minutes
// How often the runner checks whether any scheduled portfolio update is due
exports.SCHEDULED_PORTFOLIO_UPDATES_RUNNER_INTERVAL = 20 * 1000; // 20 seconds
// How long a scheduled portfolio update waits before the runner executes it, giving the
// discovery API time to index the defi position changes caused by the transaction
exports.SCHEDULED_PORTFOLIO_UPDATE_DELAY = 60 * 1000; // 1 minute
//# sourceMappingURL=intervals.js.map