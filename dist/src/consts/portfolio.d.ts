import { Platform } from '../interfaces/platform';
export declare const DEFAULT_STALE_RPC_BLOCK_THRESHOLD = 10;
export declare const ETHEREUM_STALE_RPC_BLOCK_THRESHOLD = 2;
/**
 * How long a request to our own APIs is given. Enough for the token prices, which come back in
 * a few hundred milliseconds - see `getDiscoveryTimeout` for the one request this is too tight
 * for.
 */
export declare const AMBIRE_API_TIMEOUT = 3000;
/**
 * The discovery request is the odd one out: it carries the DeFi positions and the asset hints of
 * every network at once, so its response is measured in hundreds of kilobytes rather than a few,
 * and it takes seconds rather than milliseconds. Mobile gets a longer budget for it, because a
 * cold start has nothing cached and the positions it gives up on are gone until the next update.
 * Not longer still, since the tokens are only fetched once discovery answers, so every extra
 * second is a second of blank network.
 */
export declare const MOBILE_DISCOVERY_TIMEOUT = 6000;
/** How long the portfolio discovery request is given on the current platform. */
export declare const getDiscoveryTimeout: (platform: Platform) => number;
//# sourceMappingURL=portfolio.d.ts.map