import { NameResolver, NameServiceId, ResolvedNames } from './types';
/**
 * Picks the resolver that owns a domain: a specific service by TLD, else the fallback (ENS).
 */
export declare const matchNameResolver: (resolvers: NameResolver[], domain: string) => NameResolver | undefined;
/** Resolver that owns a domain, considering every service (ignores feature flags). */
export declare const getNameService: (domain: string) => NameResolver | undefined;
/**
 * The name to display for an address, chosen by service priority (`DEFAULT_RESOLVERS` order).
 * Returns null when the address has no resolved name.
 */
export declare const getPrimaryName: (names: ResolvedNames | undefined) => {
    id: NameServiceId;
    name: string;
} | null;
/** Every name service id, in display-priority order. */
export declare const NAME_SERVICE_IDS: NameServiceId[];
/** Human-readable label per name service, keyed by id (e.g. `{ ens: 'ENS' }`). */
export declare const NAME_SERVICE_LABELS: Record<NameServiceId, string>;
/**
 * Joins every resolved name for an address into a single lowercased, space-separated string for
 * fuzzy search. Automatically covers all name services, so search keeps working when one is added.
 */
export declare const getSearchableNames: (names: ResolvedNames | undefined) => string;
//# sourceMappingURL=helpers.d.ts.map