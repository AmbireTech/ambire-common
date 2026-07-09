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
