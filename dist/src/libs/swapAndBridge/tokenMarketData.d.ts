import { QueueElement, Request } from '../../utils/batcher';
/**
 * The key under which the market data of a token is exposed to the UI. Addresses are
 * lowercased, because the casing coming from the service provider token lists and the
 * casing coming from the cena response are not guaranteed to match.
 */
export declare function getTokenMarketDataKey(chainId: number | bigint, address: string): string;
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
export declare function marketDataRequestBatcher(queue: QueueElement[]): Request[];
//# sourceMappingURL=tokenMarketData.d.ts.map