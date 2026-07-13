import { getAddress, isAddress } from 'ethers'

import { Contacts } from '@/interfaces/addressBook'

import {
  Domains,
  ExtraReverseData,
  IDomainsController,
  ResolvedReverseEntry,
  ReverseLookupOptions
} from '../../interfaces/domains'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { RPCProviders } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { IVerificationController } from '../../interfaces/verification'
import { NameExpiry, ReverseLookupResult } from '../../services/ensDomains'
import {
  DEFAULT_RESOLVERS,
  getPrimaryName,
  isNameExpiryStale,
  matchNameResolver,
  NameResolver,
  NameServiceId,
  ResolveContext,
  ResolvedNames
} from '../../services/nameResolvers'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

// 15 minutes
export const PERSIST_DOMAIN_FOR_IN_MS = 15 * 60 * 1000
export const PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS = 5 * 60 * 1000 // 5 minutes

const REVERSE_LOOKUP_TIMEOUT_MS = 15000
const RESOLUTION_VERIFY_TIMEOUT_MS = 15000
// A resolution mismatch (the RPC and Colibri returned different addresses) is the only user-facing
// resolution error. The service name in the message varies (ENS, GNS, ...), so match on the shared
// marker rather than a fixed, ENS-specific prefix.
const RESOLUTION_MISMATCH_ERROR_MARKER = 'resolution mismatch for'

const getUserFacingResolutionError = (error: any) => {
  const message = error?.message
  if (typeof message !== 'string') return undefined
  if (!message.includes(RESOLUTION_MISMATCH_ERROR_MARKER)) return undefined

  return message
}

export const PERSIST_EXPIRY_OF_SUBNAMES_FOR_IN_MS = 24 * 60 * 60 * 1000
// Once a name is within the warn window, re-poll its expiry at most this often to catch a renewal.
export const PERSIST_EXPIRY_FOR_IF_CLOSE_TO_DEADLINE_IN_MS = 1 * 60 * 60 * 1000

/**
 * Keep the cached expiry only while the primary name it belongs to is unchanged; otherwise drop it
 * so it refetches. Expiry tracks the primary name, so a change of primary (its name or the service
 * that owns it) invalidates the cached value regardless of which service is expirable.
 */
const carryOverExpiry = (existing: Domains[string] | undefined, nextNames: ResolvedNames) => {
  const previous = getPrimaryName(existing?.names ?? {})
  const next = getPrimaryName(nextNames)

  return previous?.id === next?.id && previous?.name === next?.name ? existing?.expiry : undefined
}

/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class DomainsController extends EventEmitter implements IDomainsController {
  #providers: RPCProviders = {}

  #verification?: IVerificationController

  #defaultNetworksMode: 'mainnet' | 'testnet' = 'mainnet'

  #storage?: IStorageController

  #featureFlags?: IFeatureFlagsController

  /** Name services the controller resolves against. Defaults to the built-in set; overridable for tests. */
  #resolvers: NameResolver[]

  #isNetworkEnabled: (chainId: bigint) => boolean

  /** Stores ENS names, avatars, and metadata (timestamps) indexed by account address */
  domains: Domains = {}

  /** Maps domain names to account addresses; necessary because the 'domains' state
   * only indexes by address, making getting an address for an existing domain name inefficient.
   * And is also problematic if a domain name that has been resolved doesn't have a corresponding address
   * (because no one owns it). We don't want to keep trying to resolve it every time.
   */
  domainToAddresses: {
    [domain: string]: {
      address: string | undefined
      type: NameServiceId
    }
  } = {}

  loadingAddresses: string[] = []

  resolveDomainsStatus: { [domain: string]: 'LOADING' | 'RESOLVED' | 'FAILED' | undefined } = {}

  resolveDomainsErrors: { [domain: string]: string | undefined } = {}

  verifiedDomainsStatus: { [domain: string]: 'VERIFIED' | undefined } = {}

  #reverseLookupPromises: { [address: string]: Promise<void> | undefined } = {}

  #persisting = false

  #persistScheduled = false

  constructor({
    eventEmitterRegistry,
    providers,
    verification,
    defaultNetworksMode,
    storage,
    featureFlags,
    resolvers,
    isNetworkEnabled
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    providers: RPCProviders
    verification?: IVerificationController
    defaultNetworksMode?: 'mainnet' | 'testnet'
    // Not needed for rewards/benzin as they are used for persistence and privacy opt-outs,
    // which are not relevant there
    storage?: IStorageController
    featureFlags?: IFeatureFlagsController
    resolvers?: NameResolver[]
    isNetworkEnabled: (chainId: bigint) => boolean
  }) {
    super(eventEmitterRegistry)

    this.#providers = providers
    this.#verification = verification
    if (defaultNetworksMode) this.#defaultNetworksMode = defaultNetworksMode
    this.#storage = storage
    this.#featureFlags = featureFlags
    this.#resolvers = resolvers ?? DEFAULT_RESOLVERS
    this.#isNetworkEnabled = isNetworkEnabled
  }

  /**
   * Initializes the controller with the data persisted in storage
   * As the domains in storage may be from one time requests in sign message/sign account op, we don't want
   * to load them all in a public variable which will be sent to the UI. Instead, we filter only the domains
   * that are in the address book, which includes accounts and address book contacts
   */
  async init(contacts: Contacts) {
    if (!this.#storage) return

    let domainsFromStorage: Domains = {}

    try {
      // The stored shape is normalized to the current one by a StorageController migration.
      domainsFromStorage = await this.#storage.get('domainsCache', {})
    } catch (error: any) {
      this.emitError({
        message:
          'Something went wrong when loading the Domains cache. Please try again or contact support if the problem persists.',
        level: 'silent',
        error
      })
    }

    const domains: Domains = {}

    for (const [addressInDomains, data] of Object.entries(domainsFromStorage)) {
      if (!data) continue

      const isExpired = data.expiry && data.expiry.gracePeriodEndsAt < Date.now()

      if (isExpired) {
        // Drop the expired ENS data (but keep names from other services)
        data.names.ens = null
        delete data.avatar
        delete data.expiry
        // If we don't delete it the update may be skipped if it's within the TTL
        delete data.updatedAt
      }

      const isInContacts = contacts.some(({ address }) => address === addressInDomains)
      if (isInContacts) domains[addressInDomains] = data
    }

    this.domains = domains

    this.emitUpdate()
  }

  get #keepEnsProfilesUpToDate() {
    return !!this.#featureFlags?.isFeatureEnabled('keepEnsProfilesUpToDate')
  }

  /** Resolvers enabled for the current feature-flag state */
  get #activeResolvers(): NameResolver[] {
    const featureFlags = this.#featureFlags
    return this.#resolvers.filter(
      (resolver) =>
        !resolver.featureFlag ||
        !featureFlags ||
        featureFlags.isFeatureEnabled(resolver.featureFlag)
    )
  }

  #context(): ResolveContext {
    return {
      getProvider: (chainId: string) =>
        this.#isNetworkEnabled(BigInt(chainId)) ? this.#providers[chainId] : undefined,
      networkMode: this.#defaultNetworksMode
    }
  }

  #resolverById(id: NameServiceId): NameResolver | undefined {
    return this.#resolvers.find((resolver) => resolver.id === id)
  }

  /**
   * Persists domains in storage. Writing in storage concurrently is not a good practice,
   * but using a full-blown queue is overkill and not applicable for the domains controller as we
   * are always storing this.domains. That's why this method awaits the running call (if any), skips
   * any intermediary calls, and queues the last one (e.g., if 5 calls are made, the running one is awaited and only
   * the fifth one is executed afterwards)
   */
  async #persistDomains() {
    if (!this.#storage) return

    if (this.#persisting) {
      this.#persistScheduled = true
      return
    }

    this.#persisting = true
    try {
      await this.#storage.set('domainsCache', this.domains)
    } catch (e) {
      console.warn('domains: failed to persist domains cache', e)
    } finally {
      this.#persisting = false
      if (this.#persistScheduled) {
        this.#persistScheduled = false
        void this.#persistDomains()
      }
    }
  }

  /**
   * A resolve context backed by the Colibri verifier providers instead of the app's RPC providers.
   * Resolving a domain through it re-runs the exact same service against Colibri's proven state.
   * A service whose chain has no ready verifier (e.g. Namoshi on Citrea) gets `undefined` here, so
   * its `resolve` returns null and verification is skipped rather than special-cased per service.
   */
  #verificationContext(): ResolveContext {
    return {
      getProvider: (chainId: string) =>
        this.#verification?.getReadyProvider(BigInt(chainId)) ?? undefined,
      networkMode: this.#defaultNetworksMode
    }
  }

  /**
   * Cross-checks an RPC-resolved address by re-resolving the domain through the same service against
   * Colibri's proven state. Returns true on a match, false when no ready verifier exists for the
   * service's chain (verification is skipped), and throws a user-facing error on a genuine mismatch.
   */
  async #verifyResolvedAddress(resolver: NameResolver, domain: string, address: string) {
    const verified = await withTimeout(
      () => resolver.resolve(domain, this.#verificationContext()),
      { timeoutMs: RESOLUTION_VERIFY_TIMEOUT_MS }
    )

    if (!verified) return false

    if (!verified.address && !address) return false
    if (verified.address && address && getAddress(verified.address) === getAddress(address)) {
      return true
    }

    throw new Error(
      `${resolver.label} resolution mismatch for ${domain}: RPC returned ${address}, Colibri returned ${verified.address}`
    )
  }

  #setResolveDomainFailure(domain: string, error: any) {
    const message = getUserFacingResolutionError(error)

    if (message) {
      this.resolveDomainsErrors = {
        ...this.resolveDomainsErrors,
        [domain]: message
      }
    } else {
      delete this.resolveDomainsErrors[domain]
    }
    this.resolveDomainsStatus[domain] = 'FAILED'
  }

  async batchReverseLookup(addresses: string[], updateExpiryForAddresses?: string[]) {
    const normalizedAddresses = this.#normalizeAddresses(addresses)
    const addressesToLookup = this.#getAddressesToLookup(normalizedAddresses)

    if (addressesToLookup.length) {
      const batchPromise = this.#reverseLookup(
        addressesToLookup,
        false,
        updateExpiryForAddresses
      ).finally(() => {
        addressesToLookup.forEach((address) => {
          this.#reverseLookupPromises[address] = undefined
        })
      })

      addressesToLookup.forEach((address) => {
        this.#reverseLookupPromises[address] = batchPromise
      })
    }

    // Await both the freshly started lookups and any lookups for the requested
    // addresses that are already in flight (e.g. from an earlier batch or a
    // single reverseLookup), so callers never resolve before the data is ready.
    const pendingPromises = normalizedAddresses
      .map((address) => this.#reverseLookupPromises[address])
      .filter((promise): promise is Promise<void> => !!promise)

    if (!pendingPromises.length) return

    await Promise.all(pendingPromises)

    this.emitUpdate()
  }

  /**
   * Resolves a domain and persists it to state only if resolution succeeds.
   */
  async resolveDomain({ domain }: { domain: string }) {
    const resolver = matchNameResolver(this.#activeResolvers, domain)

    // No service owns this domain (unsupported TLD, or the owning service is disabled). Mark it
    // failed and emit so a UI awaiting this resolution settles instead of hanging forever. With the
    // default resolvers this never happens (ENS is the always-active fallback), but a resolver set
    // without a fallback would otherwise leave the caller's promise unresolved.

    // @TODO: Consider persisting a "no owner" result to avoid repeated lookups for unsupported domains, but only if the domain is valid (e.g., not a random string). Otherwise, we could end up caching a lot of junk.
    if (!resolver) {
      this.resolveDomainsStatus[domain] = 'FAILED'
      await this.forceEmitUpdate()
      this.resolveDomainsStatus[domain] = undefined
      return
    }

    if (
      this.resolveDomainsStatus[domain] === 'LOADING' ||
      this.resolveDomainsStatus[domain] === 'RESOLVED'
    ) {
      return
    }

    this.resolveDomainsStatus[domain] = 'LOADING'
    delete this.resolveDomainsErrors[domain]
    delete this.verifiedDomainsStatus[domain]
    await this.forceEmitUpdate()

    if (this.domainToAddresses[domain]) {
      try {
        const cachedAddress = this.domainToAddresses[domain]?.address
        if (cachedAddress) {
          const isVerified = await this.#verifyResolvedAddress(resolver, domain, cachedAddress)
          if (isVerified) this.verifiedDomainsStatus[domain] = 'VERIFIED'
        }

        this.resolveDomainsStatus[domain] = 'RESOLVED'
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
      } catch (e: any) {
        this.emitError({
          error: e,
          message: `${resolver.label} resolution failed for ${domain}: ${e?.message || e}`,
          level: 'silent'
        })
        this.#setResolveDomainFailure(domain, e)
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
      }
      return
    }

    await resolver
      .resolve(domain, this.#context())
      .then(async (result) => {
        if (result?.address) {
          // Verify before caching, so a mismatch throws into the catch and nothing bad is persisted.
          const isVerified = await this.#verifyResolvedAddress(resolver, domain, result.address)
          if (isVerified) this.verifiedDomainsStatus[domain] = 'VERIFIED'

          this.domainToAddresses[domain] = {
            address: getAddress(result.address),
            type: resolver.id
          }
          this.#saveResolvedDomain({
            address: result.address,
            avatar: result.avatar,
            expiry: result.expiry,
            domain,
            type: resolver.id
          })
        }
        this.resolveDomainsStatus[domain] = 'RESOLVED'
        delete this.resolveDomainsErrors[domain]
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined

        // Do it after updating the status to not slow down the UI
        if (result?.address) {
          await this.#persistDomains()
        }
      })
      .catch(async (e) => {
        console.error(`Failed to resolve domain: ${domain}`, e)
        this.emitError({
          error: e,
          message: `${resolver.label} resolution failed for ${domain}: ${e?.message || e}`,
          level: 'silent'
        })
        this.#setResolveDomainFailure(domain, e)
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
      })
  }

  /**
   * Saves an already resolved name for an address. Avatar and expiry track the primary name, so they
   * are only overwritten when the just-resolved service is the primary one.
   */
  #saveResolvedDomain({
    address,
    avatar,
    expiry,
    domain,
    type
  }: {
    address: string
    domain: string
    avatar: string | null
    expiry?: NameExpiry | null
    type: NameServiceId
  }) {
    const checksummedAddress = getAddress(address)
    const existing = this.domains[checksummedAddress]
    const now = Date.now()

    const names: ResolvedNames = { ...existing?.names, [type]: domain }
    const primary = getPrimaryName(names)
    const isPrimary = primary?.id === type

    this.domains[checksummedAddress] = {
      names,
      avatar: isPrimary ? avatar : (existing?.avatar ?? null),
      expiry: isPrimary
        ? expiry !== undefined
          ? expiry
          : carryOverExpiry(existing, names)
        : (existing?.expiry ?? undefined),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
  }

  async reverseLookup(address: string, emitUpdate = true, opts?: ReverseLookupOptions) {
    if (!isAddress(address)) return

    const checksummedAddress = getAddress(address)

    // If a lookup for this address is already in flight (e.g. via
    // batchReverseLookup or a concurrent reverseLookup), await it instead of
    // starting a duplicate, so the caller resolves only once the data is ready.
    const inFlightPromise = this.#reverseLookupPromises[checksummedAddress]
    if (inFlightPromise) {
      await inFlightPromise
      return
    }

    const addressToLookup = this.#getAddressesToLookup([checksummedAddress], opts)[0]

    if (!addressToLookup) return

    this.#reverseLookupPromises[addressToLookup] = this.#reverseLookup(
      [addressToLookup],
      emitUpdate,
      opts?.updateExpiry ? [addressToLookup] : undefined
    ).finally(() => {
      this.#reverseLookupPromises[addressToLookup] = undefined
    })

    await this.#reverseLookupPromises[addressToLookup]
  }

  #normalizeAddresses(addresses: string[]) {
    return [
      ...new Set(
        addresses
          .map((address) => {
            try {
              return getAddress(address)
            } catch {
              return undefined
            }
          })
          .filter((v): v is string => !!v)
      )
    ]
  }

  #isPastTtl(entry: Domains[string] | undefined) {
    if (!entry) return true

    if (entry?.updateFailedAt)
      return Date.now() - entry.updateFailedAt > PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS

    return Date.now() - (entry?.updatedAt ?? 0) > PERSIST_DOMAIN_FOR_IN_MS
  }

  #getAddressesToLookup(addresses: string[], opts?: ReverseLookupOptions) {
    // The `keepEnsProfilesUpToDate` opt-out (off by default = privacy) forces TTL
    // refreshes everywhere; otherwise the per-call mode decides, defaulting to `whenStale`.
    const mode = this.#keepEnsProfilesUpToDate
      ? 'whenStale'
      : (opts?.privacyUpdateMode ?? 'whenStale')

    if (mode === 'never') return []

    return this.#normalizeAddresses(addresses).filter((checksummedAddress) => {
      const existing = this.domains[checksummedAddress]

      return (
        this.#isPastTtl(existing) &&
        !this.loadingAddresses.includes(checksummedAddress) &&
        !this.#reverseLookupPromises[checksummedAddress]
      )
    })
  }

  #setLookupFailure(address: string) {
    const hasBeenResolvedOnce = !!this.domains[address]?.createdAt

    if (hasBeenResolvedOnce) {
      this.domains[address]!.updateFailedAt = Date.now()
    } else {
      this.domains[address] = { names: {}, updateFailedAt: Date.now() }
    }
  }

  /**
   * Resolves names for one or multiple addresses across every enabled service.
   */
  async #reverseLookup(
    addressesToLookup: string[],
    emitUpdate = true,
    updateExpiryForAddresses?: string[]
  ) {
    if (!addressesToLookup.length) return

    const ctx = this.#context()
    const reverseResolvers = this.#activeResolvers.filter(
      (resolver) => resolver.capabilities.reverse
    )

    // const ethereumProvider =
    //   this.#providers[this.#defaultNetworksMode === 'mainnet' ? '1' : '11155111']
    // const citreaProvider = this.#isNetworkEnabled(4114n) && this.#providers['4114']

    // if (!ethereumProvider) {
    //   this.emitError({
    //     error: new Error('domains.reverseLookup: Ethereum provider is not available'),
    //     message: 'The RPC provider for Ethereum is not available.',
    //     level: 'major'
    //   })
    //   return
    // }

    this.loadingAddresses.push(...addressesToLookup)
    this.emitUpdate()

    try {
      // One batched reverse lookup per active service; each resolver uses its own chain/provider.
      const byResolver = await Promise.all(
        reverseResolvers.map((resolver) =>
          withTimeout(() => resolver.reverse(addressesToLookup, ctx), {
            timeoutMs: REVERSE_LOOKUP_TIMEOUT_MS
          })
            .then((result) => ({ resolver, result: result ?? {} }))
            .catch(
              () =>
                ({
                  resolver,
                  result: Object.fromEntries(
                    addressesToLookup.map((address) => [address, { name: null, failed: true }])
                  )
                }) as { resolver: NameResolver; result: ReverseLookupResult }
            )
        )
      )

      // The highest-priority active service drives the per-address failure state (retry on failure).
      const primaryResolverId = reverseResolvers[0]?.id

      const resolved: ResolvedReverseEntry[] = addressesToLookup.map((address) => {
        const primaryEntry = byResolver.find(({ resolver }) => resolver.id === primaryResolverId)
          ?.result[address]
        if (!primaryEntry || primaryEntry.failed) return { address, failed: true as const }

        const names: ResolvedNames = {}
        byResolver.forEach(({ resolver, result }) => {
          const entry = result[address]
          names[resolver.id] = entry && !entry.failed ? entry.name : null
        })

        return { address, failed: false as const, names }
      })

      // Avatars (and, for the selected account, the ENS expiry) can't be resolved in the reverse-lookup
      // batch - avatars need extra NFT/ipfs handling, expiry needs a separate registrar read. Resolve
      // them per address here. It's not a big deal, since most accounts won't have names.
      const extraDataByAddress = Object.fromEntries(
        await Promise.all(
          resolved.map(
            async (entry) =>
              [
                entry.address,
                await this.#resolveExtraData(
                  entry,
                  ctx,
                  !!updateExpiryForAddresses?.includes(entry.address)
                )
              ] as const
          )
        )
      )

      for (const entry of resolved) {
        if (entry.failed) {
          this.#setLookupFailure(entry.address)
          continue
        }

        const { address, names } = entry
        const primary = getPrimaryName(names)
        if (primary) this.domainToAddresses[primary.name] = { address, type: primary.id }

        const now = Date.now()
        const existing = this.domains[address]
        const extra = extraDataByAddress[address]
        this.domains[address] = {
          names,
          avatar: extra?.avatar ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          expiry: extra?.expiry ?? carryOverExpiry(existing, names)
        }
      }
    } catch (e: any) {
      console.warn('reverse name lookup failed', e)

      addressesToLookup.forEach((address) => this.#setLookupFailure(address))
    } finally {
      this.loadingAddresses = this.loadingAddresses.filter(
        (loadingAddress) => !addressesToLookup.includes(loadingAddress)
      )

      if (emitUpdate) this.emitUpdate()

      // Don't slow down the UI
      await this.#persistDomains()
    }
  }

  /**
   * Resolves the avatar (and, when requested, the expiry) for the primary name of a reverse-lookup
   * result, using that name's own service.
   */
  async #resolveExtraData(
    entry: ResolvedReverseEntry,
    ctx: ResolveContext,
    updateExpiry: boolean
  ): Promise<ExtraReverseData> {
    if (entry.failed) return { avatar: null, expiry: undefined }

    const primary = getPrimaryName(entry.names)
    if (!primary) return { avatar: null, expiry: undefined }

    const resolver = this.#resolverById(primary.id)
    if (!resolver) return { avatar: null, expiry: undefined }

    const [avatar, expiry] = await Promise.all([
      resolver.capabilities.avatar
        ? withTimeout(() => resolver.getAvatar(primary.name, ctx), {
            timeoutMs: REVERSE_LOOKUP_TIMEOUT_MS
          }).catch(() => null)
        : Promise.resolve(null),
      updateExpiry && resolver.capabilities.expiry
        ? this.#fetchExpiryIfStale(entry.address, primary.name, resolver, ctx)
        : Promise.resolve(undefined)
    ])

    return { avatar, expiry }
  }

  /**
   * Fetches a name's expiry only when the cached value is missing or stale, per the resolver's own
   * refresh policy. Returns `undefined` when the cache is still good or the read fails, so the caller keeps the cached value.
   */
  async #fetchExpiryIfStale(
    checksummedAddress: string,
    name: string,
    resolver: NameResolver,
    ctx: ResolveContext
  ): Promise<NameExpiry | null | undefined> {
    if (!resolver.getExpiry) return undefined

    const cachedExpiry = this.domains[checksummedAddress]?.expiry
    const shouldRefetch = resolver.shouldRefetchExpiry
      ? resolver.shouldRefetchExpiry(name, cachedExpiry)
      : isNameExpiryStale(cachedExpiry)
    if (!shouldRefetch) return undefined

    try {
      return await resolver.getExpiry(name, ctx)
    } catch (e) {
      this.emitError({
        error: e as Error,
        message: `Failed to fetch expiry for ${name}`,
        level: 'silent'
      })

      return undefined
    }
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
