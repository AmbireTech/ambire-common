"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSearchableNames = exports.NAME_SERVICE_LABELS = exports.NAME_SERVICE_IDS = exports.getPrimaryName = exports.getNameService = exports.matchNameResolver = void 0;
const resolvers_1 = require("./resolvers");
/**
 * Picks the resolver that owns a domain: a specific service by TLD, else the fallback (ENS).
 */
const matchNameResolver = (resolvers, domain) => resolvers.find((resolver) => !resolver.isFallback && resolver.matches(domain)) ??
    resolvers.find((resolver) => resolver.isFallback);
exports.matchNameResolver = matchNameResolver;
/** Resolver that owns a domain, considering every service (ignores feature flags). */
const getNameService = (domain) => (0, exports.matchNameResolver)(resolvers_1.DEFAULT_RESOLVERS, domain);
exports.getNameService = getNameService;
/**
 * The name to display for an address, chosen by service priority (`DEFAULT_RESOLVERS` order).
 * Returns null when the address has no resolved name.
 */
const getPrimaryName = (names) => {
    if (!names)
        return null;
    for (const resolver of resolvers_1.DEFAULT_RESOLVERS) {
        const name = names[resolver.id];
        if (name)
            return { id: resolver.id, name };
    }
    return null;
};
exports.getPrimaryName = getPrimaryName;
/** Every name service id, in display-priority order. */
exports.NAME_SERVICE_IDS = resolvers_1.DEFAULT_RESOLVERS.map((resolver) => resolver.id);
/** Human-readable label per name service, keyed by id (e.g. `{ ens: 'ENS' }`). */
exports.NAME_SERVICE_LABELS = Object.fromEntries(resolvers_1.DEFAULT_RESOLVERS.map((resolver) => [resolver.id, resolver.label]));
/**
 * Joins every resolved name for an address into a single lowercased, space-separated string for
 * fuzzy search. Automatically covers all name services, so search keeps working when one is added.
 */
const getSearchableNames = (names) => exports.NAME_SERVICE_IDS.map((id) => names?.[id]?.toLowerCase().trim())
    .filter(Boolean)
    .join(' ');
exports.getSearchableNames = getSearchableNames;
//# sourceMappingURL=helpers.js.map