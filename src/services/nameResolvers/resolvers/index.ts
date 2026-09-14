import { NameResolver } from '../types'
import { EnsResolver } from './EnsResolver'
import { GnsResolver } from './GnsResolver'
import { NamoshiResolver } from './NamoshiResolver'

export * from './EnsCompatibleResolver'
export * from './EnsResolver'
export * from './NamoshiResolver'
export * from './GnsResolver'

/**
 * All name services the wallet resolves, in display-priority order (first match wins when an address
 * has names in several services). ENS is the fallback and the current primary.
 */
export const DEFAULT_RESOLVERS: NameResolver[] = [
  new EnsResolver(),
  new NamoshiResolver(),
  new GnsResolver()
]
