import { FeatureFlags } from '@/consts/featureFlags'
import { RPCProvider } from '@/interfaces/provider'
import { NameExpiry, ReverseLookupResult } from '@/services/ensDomains'

export type NameServiceId = 'ens' | 'namoshi' | 'gns'

export type NetworkMode = 'mainnet' | 'testnet'

/** Resolved primary names for an address, keyed by name service. */
export type ResolvedNames = Partial<Record<NameServiceId, string | null>>

export type ResolveContext = {
  /**
   * Access to the app's RPC providers (owned by `ProvidersController`). A resolver picks the
   * chain(s) it needs and returns null/failed when a provider it needs is unavailable — it never
   * constructs a provider itself.
   */
  getProvider: (chainId: string) => RPCProvider | undefined
  networkMode: NetworkMode
}

export type ForwardResolution = {
  address: string
  avatar: string | null
  expiry: NameExpiry | null
}

/**
 * A name service the wallet can resolve names against. To add one, add a resolver class under
 * `resolvers/` and register it in `resolvers/index.ts`: services that expose an ENS-compatible
 * universal resolver extend `EnsCompatibleResolver`, while a genuinely different system (e.g.
 * Unstoppable, Lens) implements this contract directly. The
 * controller depends only on this interface — it never learns how a given service resolves.
 */
export interface NameResolver {
  readonly id: NameServiceId
  /** Omit to always enable; otherwise the service is gated by this feature flag. */
  readonly featureFlag?: keyof FeatureFlags
  /**
   * Exactly one resolver is the fallback (ENS): it handles any name not claimed by a more specific
   * service. `matches` is consulted for specific services first, the fallback last.
   */
  readonly isFallback?: boolean
  readonly capabilities: { reverse: boolean; avatar: boolean; expiry: boolean }
  matches(domain: string): boolean
  resolve(domain: string, ctx: ResolveContext): Promise<ForwardResolution | null>
  reverse(addresses: string[], ctx: ResolveContext): Promise<ReverseLookupResult>
  getAvatar(name: string, ctx: ResolveContext): Promise<string | null>
  getExpiry?(name: string, ctx: ResolveContext): Promise<NameExpiry | null>
  /**
   * Whether the cached expiry for `name` should be refetched. A service whose expiry can move
   * unexpectedly (ENS wrapped subnames) layers its own rule on top of the generic `isNameExpiryStale`.
   * Only meaningful when `capabilities.expiry` is true.
   */
  shouldRefetchExpiry?(name: string, cachedExpiry: NameExpiry | null | undefined): boolean
}
