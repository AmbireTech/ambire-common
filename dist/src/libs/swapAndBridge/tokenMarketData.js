"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenMarketDataKey = getTokenMarketDataKey;
exports.marketDataRequestBatcher = marketDataRequestBatcher;
const ethers_1 = require("ethers");
const paginate_1 = require("../../utils/paginate");
// Max tokens per request, mirroring the portfolio's gecko batcher
const BATCH_LIMIT = 40;
const CENA_API_URL = 'https://cena.ambire.com';
/**
 * The key under which the market data of a token is exposed to the UI. Addresses are
 * lowercased, because the casing coming from the service provider token lists and the
 * casing coming from the cena response are not guaranteed to match.
 */
function getTokenMarketDataKey(chainId, address) {
    return `${chainId.toString()}:${address.toLowerCase()}`;
}
/**
 * Splits the queued tokens into one request per CoinGecko platform (and per page of
 * BATCH_LIMIT tokens within it), because the cena token price route is keyed by
 * platform. Tokens on chains without a platform id must never reach the queue, as the
 * batcher leaves the promises of queue elements dropped here unresolved.
 *
 * Native tokens aren't real contracts, so CoinGecko can't look them up by address on
 * that same route - they are routed to the coin price route instead, grouped by
 * `nativeAssetId` (their CoinGecko coin id) rather than by platform, since the same
 * native asset (e.g. ETH) is shared across multiple chains.
 */
function marketDataRequestBatcher(queue) {
    const nativeQueue = [];
    const platformSegments = {};
    queue.forEach((queueItem) => {
        const { address, platformId } = queueItem.data;
        if (address === ethers_1.ZeroAddress) {
            nativeQueue.push(queueItem);
            return;
        }
        if (!platformSegments[platformId])
            platformSegments[platformId] = [];
        platformSegments[platformId].push(queueItem);
    });
    const contractRequests = Object.entries(platformSegments)
        .map(([platformId, queueSegment]) => (0, paginate_1.paginate)(queueSegment, BATCH_LIMIT).map((page) => ({ platformId, queueSegment: page })))
        .flat(1)
        .map(({ platformId, queueSegment }) => {
        const addresses = [...new Set(queueSegment.map((x) => x.data.address))];
        const url = `${CENA_API_URL}/api/v3/simple/token_price/${platformId}?contract_addresses=${addresses.join(',')}&vs_currencies=usd`;
        return { url, queueSegment };
    });
    const nativeRequests = (0, paginate_1.paginate)(nativeQueue, BATCH_LIMIT).map((queueSegment) => {
        const ids = [...new Set(queueSegment.map((x) => x.data.nativeAssetId))];
        const url = `${CENA_API_URL}/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
        return { url, queueSegment };
    });
    return [...contractRequests, ...nativeRequests];
}
//# sourceMappingURL=tokenMarketData.js.map