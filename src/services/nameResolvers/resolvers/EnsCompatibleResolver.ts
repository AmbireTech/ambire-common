import { FeatureFlags } from '@/consts/featureFlags'
import {
  getEnsAvatar,
  getEnsExpiry,
  NameExpiry,
  resolveENSDomain,
  reverseLookupEns,
  ReverseLookupResult
} from '@/services/ensDomains'

import { isNameExpiryStale } from '../expiry'
import {
  ForwardResolution,
  NameResolver,
  NameServiceId,
  NetworkMode,
  ResolveContext
} from '../types'

export const ETHEREUM_CHAIN_ID = { mainnet: '1', testnet: '11155111' }

export type EnsCompatibleConfig = {
  id: NameServiceId
  label: string
  universalResolver: string
  chainId: { mainnet: string; testnet: string }
  featureFlag?: keyof FeatureFlags
  isFallback?: boolean
  /** Present when the service has an ENS registrar/NameWrapper, which is what makes it expirable. */
  expiry?: { baseRegistrar: string; nameWrapper: { mainnet: string; testnet: string } }
}

/**
 * Shared implementation for ENS and ENS-compatible services: same universal-resolver interface, a
 * different contract address and, optionally, a different chain.
 */
export abstract class EnsCompatibleResolver implements NameResolver {
  readonly id: NameServiceId

  readonly label: string

  readonly featureFlag?: keyof FeatureFlags

  readonly isFallback: boolean

  readonly capabilities: { reverse: boolean; avatar: boolean; expiry: boolean }

  protected readonly universalResolver: string

  protected readonly chainId: { mainnet: string; testnet: string }

  protected readonly expiryConfig?: EnsCompatibleConfig['expiry']

  constructor(config: EnsCompatibleConfig) {
    this.id = config.id
    this.label = config.label
    this.featureFlag = config.featureFlag
    this.isFallback = config.isFallback ?? false
    this.universalResolver = config.universalResolver
    this.chainId = config.chainId
    this.expiryConfig = config.expiry
    this.capabilities = { reverse: true, avatar: true, expiry: !!config.expiry }
  }

  abstract matches(domain: string): boolean

  requiredChainId(networkMode: NetworkMode): string | undefined {
    return this.chainId[networkMode]
  }

  protected providerFor(ctx: ResolveContext) {
    return ctx.getProvider(this.chainId[ctx.networkMode])
  }

  async resolve(domain: string, ctx: ResolveContext): Promise<ForwardResolution | null> {
    const provider = this.providerFor(ctx)
    if (!provider) return null

    return resolveENSDomain({
      provider,
      domain,
      options: {
        universalResolverAddress: this.universalResolver,
        expiry: this.expiryConfig
          ? {
              baseRegistrar: this.expiryConfig.baseRegistrar,
              nameWrapper: this.expiryConfig.nameWrapper[ctx.networkMode]
            }
          : null
      }
    })
  }

  async reverse(addresses: string[], ctx: ResolveContext): Promise<ReverseLookupResult> {
    const provider = this.providerFor(ctx)
    // A missing provider is transient/config-dependent, so flag the batch as failed (the controller
    // retries on failure) rather than caching a "no name" result.
    if (!provider)
      return Object.fromEntries(addresses.map((a) => [a, { name: null, failed: true }]))

    return reverseLookupEns(addresses, provider, {
      universalResolverAddress: this.universalResolver
    })
  }

  async getAvatar(name: string, ctx: ResolveContext): Promise<string | null> {
    const provider = this.providerFor(ctx)
    if (!provider) return null

    return getEnsAvatar(name, provider, { universalResolverAddress: this.universalResolver })
  }

  async getExpiry(name: string, ctx: ResolveContext): Promise<NameExpiry | null> {
    if (!this.expiryConfig) return null

    const provider = this.providerFor(ctx)
    if (!provider) return null

    return getEnsExpiry(provider, {
      name,
      addresses: {
        baseRegistrar: this.expiryConfig.baseRegistrar,
        nameWrapper: this.expiryConfig.nameWrapper[ctx.networkMode]
      }
    })
  }

  shouldRefetchExpiry(_name: string, cachedExpiry: NameExpiry | null | undefined): boolean {
    return isNameExpiryStale(cachedExpiry)
  }
}
