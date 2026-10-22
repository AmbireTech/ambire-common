"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiscoveryTimeout = exports.MOBILE_DISCOVERY_TIMEOUT = exports.AMBIRE_API_TIMEOUT = exports.ETHEREUM_STALE_RPC_BLOCK_THRESHOLD = exports.DEFAULT_STALE_RPC_BLOCK_THRESHOLD = void 0;
// Different invictus requests can hit different providers so we allow a few blocks of difference
exports.DEFAULT_STALE_RPC_BLOCK_THRESHOLD = 10;
// Ethereum blocks are ~12s apart, so every tolerated block is a long stretch of stale data
exports.ETHEREUM_STALE_RPC_BLOCK_THRESHOLD = 2;
/**
 * How long a request to our own APIs is given. Enough for the token prices, which come back in
 * a few hundred milliseconds - see `getDiscoveryTimeout` for the one request this is too tight
 * for.
 */
exports.AMBIRE_API_TIMEOUT = 3000;
/**
 * The discovery request is the odd one out: it carries the DeFi positions and the asset hints of
 * every network at once, so its response is measured in hundreds of kilobytes rather than a few,
 * and it takes seconds rather than milliseconds. Mobile gets a longer budget for it, because a
 * cold start has nothing cached and the positions it gives up on are gone until the next update.
 * Not longer still, since the tokens are only fetched once discovery answers, so every extra
 * second is a second of blank network.
 */
exports.MOBILE_DISCOVERY_TIMEOUT = 6000;
/** How long the portfolio discovery request is given on the current platform. */
const getDiscoveryTimeout = (platform) => platform.startsWith('mobile') ? exports.MOBILE_DISCOVERY_TIMEOUT : exports.AMBIRE_API_TIMEOUT;
exports.getDiscoveryTimeout = getDiscoveryTimeout;
//# sourceMappingURL=portfolio.js.map