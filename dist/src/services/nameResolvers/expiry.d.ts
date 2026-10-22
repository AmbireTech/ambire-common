import { NameExpiry } from '../ensDomains/ensDomains';
export declare const EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS: number;
/**
 * Generic staleness check for a cached name expiry, independent of the naming service:
 * - never fetched -> refetch
 * - far from the grace-period deadline -> keep it (registration expiries rarely move)
 * - close to the deadline and the cache is old -> refetch to catch a renewal
 *
 * A service whose expiry can move unexpectedly (e.g. ENS wrapped subnames) layers its own rule on
 * top of this via `NameResolver.shouldRefetchExpiry`.
 */
export declare const isNameExpiryStale: (cachedExpiry: NameExpiry | null | undefined) => boolean;
//# sourceMappingURL=expiry.d.ts.map