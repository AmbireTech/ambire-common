import { ToTokenMarketDataStatus } from '../interfaces/swapAndBridge';
export declare const HARD_CODED_CURRENCY = "usd";
export declare const ROUTE_SORT_AMOUNT_THRESHOLD_PERCENT = 1.2;
export declare const CONVERSION_PRECISION = 16;
export declare const CONVERSION_PRECISION_POW: bigint;
export declare const NETWORK_MISMATCH_MESSAGE = "Swap & Bridge network configuration mismatch. Please try again or contact Ambire support.";
export declare const TO_TOKEN_LIST_LIMIT = 100;
export declare const TO_TOKEN_PRICE_TIMEOUT_MS = 4000;
export declare const SUPPORTED_CHAINS_CACHE_THRESHOLD: number;
export declare const TO_TOKEN_LIST_CACHE_THRESHOLD: number;
export declare const MARKET_DATA_THRESHOLD: number;
export declare const MARKET_DATA_NOT_FOUND_THRESHOLD: number;
export declare const MARKET_DATA_FAIL_THRESHOLD: number;
export declare const MARKET_DATA_LOADING_DEADLINE: number;
export declare const MARKET_DATA_THRESHOLD_BY_STATUS: {
    [status in ToTokenMarketDataStatus]: number;
};
//# sourceMappingURL=swapAndBridge.d.ts.map