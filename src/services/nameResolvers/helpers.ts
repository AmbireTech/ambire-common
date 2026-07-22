import { DEFAULT_RESOLVERS } from './resolvers'
import { NameResolver, NameServiceId, ResolvedNames } from './types'

/**
 * Picks the resolver that owns a domain: a specific service by TLD, else the fallback (ENS).
 */
export const matchNameResolver = (
  resolvers: NameResolver[],
  domain: string
): NameResolver | undefined =>
  resolvers.find((resolver) => !resolver.isFallback && resolver.matches(domain)) ??
  resolvers.find((resolver) => resolver.isFallback)

/** Resolver that owns a domain, considering every service (ignores feature flags). */
export const getNameService = (domain: string): NameResolver | undefined =>
  matchNameResolver(DEFAULT_RESOLVERS, domain)

/**
 * The name to display for an address, chosen by service priority (`DEFAULT_RESOLVERS` order).
 * Returns null when the address has no resolved name.
 */
export const getPrimaryName = (
  names: ResolvedNames | undefined
): { id: NameServiceId; name: string } | null => {
  if (!names) return null

  for (const resolver of DEFAULT_RESOLVERS) {
    const name = names[resolver.id]
    if (name) return { id: resolver.id, name }
  }

  return null
}

/** Every name service id, in display-priority order. */
export const NAME_SERVICE_IDS: NameServiceId[] = DEFAULT_RESOLVERS.map((resolver) => resolver.id)

/** Human-readable label per name service, keyed by id (e.g. `{ ens: 'ENS' }`). */
export const NAME_SERVICE_LABELS = Object.fromEntries(
  DEFAULT_RESOLVERS.map((resolver) => [resolver.id, resolver.label])
) as Record<NameServiceId, string>

/**
 * Joins every resolved name for an address into a single lowercased, space-separated string for
 * fuzzy search. Automatically covers all name services, so search keeps working when one is added.
 */
export const getSearchableNames = (names: ResolvedNames | undefined): string =>
  NAME_SERVICE_IDS.map((id) => names?.[id]?.toLowerCase().trim())
    .filter(Boolean)
    .join(' ')
