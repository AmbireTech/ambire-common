"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MARKET_DATA_THRESHOLD_BY_STATUS = exports.MARKET_DATA_LOADING_DEADLINE = exports.MARKET_DATA_FAIL_THRESHOLD = exports.MARKET_DATA_NOT_FOUND_THRESHOLD = exports.MARKET_DATA_THRESHOLD = exports.TO_TOKEN_LIST_CACHE_THRESHOLD = exports.SUPPORTED_CHAINS_CACHE_THRESHOLD = exports.TO_TOKEN_PRICE_TIMEOUT_MS = exports.TO_TOKEN_LIST_LIMIT = exports.NETWORK_MISMATCH_MESSAGE = exports.CONVERSION_PRECISION_POW = exports.CONVERSION_PRECISION = exports.ROUTE_SORT_AMOUNT_THRESHOLD_PERCENT = exports.HARD_CODED_CURRENCY = void 0;
exports.HARD_CODED_CURRENCY = 'usd';
// The amount threshold in % used by sortSwapAndBridgeRoutes. If the output value
// difference between two routes is below this, the sort falls back to service time
exports.ROUTE_SORT_AMOUNT_THRESHOLD_PERCENT = 1.2;
exports.CONVERSION_PRECISION = 16;
exports.CONVERSION_PRECISION_POW = BigInt(10 ** exports.CONVERSION_PRECISION);
exports.NETWORK_MISMATCH_MESSAGE = 'Swap & Bridge network configuration mismatch. Please try again or contact Ambire support.';
// For performance reasons, limit the max number of tokens in the to token list
exports.TO_TOKEN_LIST_LIMIT = 100;
exports.TO_TOKEN_PRICE_TIMEOUT_MS = 4000;
exports.SUPPORTED_CHAINS_CACHE_THRESHOLD = 1000 * 60 * 60 * 24; // 1 day
exports.TO_TOKEN_LIST_CACHE_THRESHOLD = 1000 * 60 * 60 * 4; // 4 hours
// Market data (24h change, market cap) goes stale fast, so a short threshold. Displaying
// a day-old price movement next to a token the user is about to receive would be misleading.
exports.MARKET_DATA_THRESHOLD = 1000 * 60 * 10; // 10 minutes
// Many of the tokens in the service provider lists are not tracked by our price API at all.
// Their absence is effectively permanent, so don't keep asking for them.
exports.MARKET_DATA_NOT_FOUND_THRESHOLD = 1000 * 60 * 60 * 24; // 1 day
exports.MARKET_DATA_FAIL_THRESHOLD = 1000 * 60 * 2; // 2 minutes
// Frees records left in a loading state by a request that can no longer complete, for
// instance because the background got suspended mid-flight. Without it such records
// would never be requested again and their tokens would load forever.
exports.MARKET_DATA_LOADING_DEADLINE = 1000 * 30; // 30 seconds
exports.MARKET_DATA_THRESHOLD_BY_STATUS = {
    DONE: exports.MARKET_DATA_THRESHOLD,
    NOT_FOUND: exports.MARKET_DATA_NOT_FOUND_THRESHOLD,
    FAIL: exports.MARKET_DATA_FAIL_THRESHOLD,
    LOADING: exports.MARKET_DATA_LOADING_DEADLINE
};
//# sourceMappingURL=swapAndBridge.js.map