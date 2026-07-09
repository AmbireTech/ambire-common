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
import { RPCProvider, RPCProviders } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { IVerificationController } from '../../interfaces/verification'
import {
  ENS_EXPIRY_WARN_WINDOW_IN_MS,
  ENS_NAME_WRAPPER,
  ENS_NAME_WRAPPER_SEPOLIA,
  getEnsAvatar,
  getEnsExpiry,
  getIsNamoshiDomain,
  NameExpiry,
  resolveENSDomain,
  reverseLookupEns,
  ReverseLookupResult
} from '../../services/ensDomains'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

// 15 minutes
export const PERSIST_DOMAIN_FOR_IN_MS = 15 * 60 * 1000
export const PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS = 5 * 60 * 1000 // 5 minutes
const USER_FACING_RESOLUTION_ERROR_PREFIX = 'ENS resolution mismatch for'

const getUserFacingResolutionError = (error: any) => {
  const message = error?.message
  if (typeof message !== 'string') return undefined
  if (!message.startsWith(USER_FACING_RESOLUTION_ERROR_PREFIX)) return undefined

  return message
}

export const PERSIST_EXPIRY_OF_SUBNAMES_FOR_IN_MS = 24 * 60 * 60 * 1000
// Once a name is within the warn window, re-poll its expiry at most this often to catch a renewal.
export const PERSIST_EXPIRY_FOR_IF_CLOSE_TO_DEADLINE_IN_MS = 1 * 60 * 60 * 1000

/**
 * Decides whether to (re)fetch a name's ENS expiry.
 */
export const shouldRefetchEnsExpiry = (entry?: Domains[string]): boolean => {
  const isEnsSubname = entry?.ens && entry.ens.split('.').length > 2

  // Subnames wrapped via the NameWrapper, the parent name's owner can set an arbitrary expiry on a
  // child/subname via setChildFuses, and that expiry is not constrained to only increase.
  if (
    isEnsSubname &&
    entry &&
    entry.ensExpiry &&
    entry.ensExpiry.updatedAt + PERSIST_EXPIRY_OF_SUBNAMES_FOR_IN_MS < Date.now()
  ) {
    return true
  }

  const cached = entry?.ensExpiry
  if (!cached) return true

  const isCloseToDeadline = cached.gracePeriodEndsAt - Date.now() < ENS_EXPIRY_WARN_WINDOW_IN_MS
  if (!isCloseToDeadline) return false

  return cached.updatedAt + PERSIST_EXPIRY_FOR_IF_CLOSE_TO_DEADLINE_IN_MS < Date.now()
}

/**
 * Keep the cached expiry only while the primary name is unchanged; otherwise drop it so it refetches.
 */
const carryOverEnsExpiry = (existing: Domains[string] | undefined, nextEns: string | null) =>
  existing?.ens === nextEns ? existing?.ensExpiry : undefined

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
      type: 'ens' | 'namoshi'
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
    featureFlags
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    providers: RPCProviders
    verification?: IVerificationController
    defaultNetworksMode?: 'mainnet' | 'testnet'
    // Not needed for rewards/benzin as they are used for persistence and privacy opt-outs,
    // which are not relevant there
    storage?: IStorageController
    featureFlags?: IFeatureFlagsController
  }) {
    super(eventEmitterRegistry)

    this.#providers = providers
    this.#verification = verification
    if (defaultNetworksMode) this.#defaultNetworksMode = defaultNetworksMode
    this.#storage = storage
    this.#featureFlags = featureFlags
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
      domainsFromStorage = await this.#storage.get('domainsCache', {})
    } catch (error: any) {
      this.emitError({
        message:
          'Something went wrong when loading the Domains cache. Please try again or contact support if the problem persists.',
        level: 'silent',
        error
      })
    }

    domainsFromStorage = Object.fromEntries(
      Object.entries(domainsFromStorage).filter(([addressInDomains, data]) => {
        if (!data) return false

        const isExpired = data.ensExpiry && data.ensExpiry.gracePeriodEndsAt < Date.now()

        if (isExpired && data) {
          // Delete all ens data for expired domains (but not that of other providers)
          data.ens = null
          delete data.ensAvatar
          delete data.ensExpiry
          // If we don't delete it the update may be skipped if it's within the TTL
          delete data.updatedAt
        }

        const isInContacts = contacts.some(({ address }) => address === addressInDomains)

        return isInContacts
      })
    )

    this.domains = domainsFromStorage

    this.emitUpdate()
  }

  get #keepEnsProfilesUpToDate() {
    return !!this.#featureFlags?.isFeatureEnabled('keepEnsProfilesUpToDate')
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

  async #verifyEnsResolution({
    providerChainId,
    domain,
    address,
    isNamoshiDomain
  }: {
    providerChainId: string
    domain: string
    address: string
    isNamoshiDomain: boolean
  }) {
    if (isNamoshiDomain) return false

    const verificationProvider = this.#verification?.getReadyProvider(BigInt(providerChainId))
    if (!verificationProvider) return false

    const verifiedResult = await withTimeout(
      () =>
        resolveENSDomain({
          provider: verificationProvider,
          domain,
          options: { isNamoshiDomain }
        }),
      { timeoutMs: 15000 }
    )

    if (!verifiedResult.address && !address) return false
    if (
      verifiedResult.address &&
      address &&
      getAddress(verifiedResult.address) === getAddress(address)
    ) {
      return true
    }

    throw new Error(
      `ENS resolution mismatch for ${domain}: RPC returned ${address}, Colibri returned ${verifiedResult.address}`
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
   * Resolves an ENS domain and persists it to state only if resolution succeeds.
   */
  async resolveDomain({ domain }: { domain: string }) {
    const isNamoshiDomain = getIsNamoshiDomain(domain)
    const providerChainId = isNamoshiDomain
      ? '4114'
      : this.#defaultNetworksMode === 'mainnet'
        ? '1'
        : '11155111'
    const provider = this.#providers[providerChainId]

    if (!provider) {
      // Don't emit an error if the citrea provider is missing
      if (isNamoshiDomain) return

      this.emitError({
        error: new Error('domains.resolveDomain: Ethereum provider is not available'),
        message: 'The RPC provider for Ethereum is not available.',
        level: 'major'
      })
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
        if (this.domainToAddresses[domain]?.address) {
          const isEnsVerifiedByColibri = await this.#verifyEnsResolution({
            providerChainId,
            domain,
            address: this.domainToAddresses[domain]!.address!,
            isNamoshiDomain
          })
          if (isEnsVerifiedByColibri) this.verifiedDomainsStatus[domain] = 'VERIFIED'
        }

        this.resolveDomainsStatus[domain] = 'RESOLVED'
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
      } catch (e: any) {
        this.emitError({
          error: e,
          message: `ENS resolution failed for ${domain}: ${e?.message || e}`,
          level: 'silent'
        })
        this.#setResolveDomainFailure(domain, e)
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
      }
      return
    }

    const nameWrapperAddress =
      this.#defaultNetworksMode === 'mainnet' ? ENS_NAME_WRAPPER : ENS_NAME_WRAPPER_SEPOLIA

    await resolveENSDomain({
      provider: provider,
      domain,
      options: { isNamoshiDomain, nameWrapperAddress }
    })
      .then(async ({ address, avatar, expiry }) => {
        if (address) {
          const isEnsVerifiedByColibri = await this.#verifyEnsResolution({
            providerChainId,
            domain,
            address,
            isNamoshiDomain
          })
          if (isEnsVerifiedByColibri) this.verifiedDomainsStatus[domain] = 'VERIFIED'

          this.domainToAddresses[domain] = {
            address: getAddress(address),
            type: isNamoshiDomain ? 'namoshi' : 'ens'
          }
          this.#saveResolvedDomain({
            address,
            ensAvatar: avatar,
            ensExpiry: expiry,
            domain,
            type: isNamoshiDomain ? 'namoshi' : 'ens'
          })
        }
        this.resolveDomainsStatus[domain] = 'RESOLVED'
        delete this.resolveDomainsErrors[domain]
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined

        // Do it after updating the status to not slow down the UI
        if (address) {
          await this.#persistDomains()
        }
      })
      .catch(async (e) => {
        console.error(`Failed to resolve ENS domain: ${domain}`, e)
        this.emitError({
          error: e,
          message: `ENS resolution failed for ${domain}: ${e?.message || e}`,
          level: 'silent'
        })
        this.#setResolveDomainFailure(domain, e)
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
      })
  }

  /**
   * Saves an already resolved ENS name for an address.
   */
  #saveResolvedDomain({
    address,
    ensAvatar,
    ensExpiry,
    domain,
    type
  }: {
    address: string
    domain: string
    ensAvatar: string | null
    ensExpiry?: NameExpiry | null
    type: 'ens' | 'namoshi'
  }) {
    const checksummedAddress = getAddress(address)
    const { ens: prevEns } = this.domains[checksummedAddress] || { ens: null }

    const existing = this.domains[checksummedAddress]
    const now = Date.now()
    const nextEns = type === 'ens' ? domain : prevEns

    this.domains[checksummedAddress] = {
      ensAvatar: type === 'ens' ? ensAvatar : (existing?.ensAvatar ?? null),
      ens: nextEns,
      namoshi: type === 'namoshi' ? domain : (existing?.namoshi ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ensExpiry:
        type === 'ens' && ensExpiry !== undefined
          ? ensExpiry
          : carryOverEnsExpiry(existing, nextEns)
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
      this.domains[address] = { ens: null, namoshi: null, updateFailedAt: Date.now() }
    }
  }

  /**
   * Resolves ENS names for one or multiple addresses.
   */
  async #reverseLookup(
    addressesToLookup: string[],
    emitUpdate = true,
    updateExpiryForAddresses?: string[]
  ) {
    if (!addressesToLookup.length) return

    const ethereumProvider =
      this.#providers[this.#defaultNetworksMode === 'mainnet' ? '1' : '11155111']
    const citreaProvider = this.#providers['4114']

    if (!ethereumProvider) {
      this.emitError({
        error: new Error('domains.reverseLookup: Ethereum provider is not available'),
        message: 'The RPC provider for Ethereum is not available.',
        level: 'major'
      })
      return
    }

    this.loadingAddresses.push(...addressesToLookup)
    this.emitUpdate()

    try {
      const [ensByAddress, namoshiByAddress] = await Promise.all([
        withTimeout(() => reverseLookupEns(addressesToLookup, ethereumProvider), {
          timeoutMs: 15000
        }),
        withTimeout(
          () => {
            if (!citreaProvider) return Promise.resolve<ReverseLookupResult>({})

            return reverseLookupEns(addressesToLookup, citreaProvider, {
              isNamoshiDomain: true
            })
          },
          {
            timeoutMs: 15000
          }
        )
      ])

      const resolved = addressesToLookup.map((address) => {
        const ensEntry = ensByAddress[address]
        if (!ensEntry || ensEntry.failed) return { address, failed: true as const }

        const namoshiEntry = namoshiByAddress[address]
        return {
          address,
          failed: false as const,
          ens: ensEntry.name,
          namoshi: namoshiEntry && !namoshiEntry.failed ? namoshiEntry.name : null
        }
      })

      // Avatars (and, for the selected account, the ENS expiry) can't be resolved in the reverse-lookup
      // batch - avatars need extra NFT/ipfs handling, expiry needs a separate registrar read. Resolve
      // them per address here. It's not a big deal, since most accounts won't have ENS names.
      const extraDataByAddress = Object.fromEntries(
        await Promise.all(
          resolved.map(
            async (entry) =>
              [
                entry.address,
                await this.#resolveExtraData(
                  entry,
                  ethereumProvider,
                  citreaProvider,
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

        const { address, ens, namoshi } = entry

        if (ens) {
          this.domainToAddresses[ens] = { address, type: 'ens' }
        } else if (namoshi && citreaProvider) {
          this.domainToAddresses[namoshi] = { address, type: 'namoshi' }
        }

        const now = Date.now()
        const existing = this.domains[address]
        const extra = extraDataByAddress[address]
        this.domains[address] = {
          ens,
          namoshi,
          ensAvatar: extra?.avatar ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          ensExpiry: extra?.ensExpiry ?? carryOverEnsExpiry(existing, ens)
        }
      }
    } catch (e: any) {
      console.warn('reverse ENS/Namoshi lookup failed', e)

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
   * Resolves the avatar (and, when requested, the ENS expiry) for a single reverse-lookup result.
   */
  async #resolveExtraData(
    entry: ResolvedReverseEntry,
    ethereumProvider: RPCProvider,
    citreaProvider: RPCProvider | undefined,
    updateExpiry: boolean
  ): Promise<ExtraReverseData> {
    if (entry.failed) return { avatar: null, ensExpiry: undefined }

    if (entry.ens) {
      const ensName = entry.ens
      const [avatar, ensExpiry] = await Promise.all([
        withTimeout(() => getEnsAvatar(ensName, ethereumProvider), { timeoutMs: 15000 }).catch(
          () => null
        ),
        updateExpiry
          ? this.#fetchEnsExpiryIfStale(entry.address, ensName, ethereumProvider)
          : Promise.resolve(undefined)
      ])
      return { avatar, ensExpiry }
    }

    if (entry.namoshi && citreaProvider) {
      const namoshiName = entry.namoshi
      const avatar = await withTimeout(
        () => getEnsAvatar(namoshiName, citreaProvider, { isNamoshiDomain: true }),
        { timeoutMs: 15000 }
      ).catch(() => null)
      return { avatar, ensExpiry: undefined }
    }

    return { avatar: null, ensExpiry: undefined }
  }

  /**
   * Fetches a name's ENS expiry only when the cached value is missing or stale (see
   * `shouldRefetchEnsExpiry`). Returns `undefined` when the cache is still good or the read fails, so
   * the caller falls back to the cached value rather than overwriting it.
   */
  async #fetchEnsExpiryIfStale(
    checksummedAddress: string,
    ens: string,
    provider: RPCProvider
  ): Promise<NameExpiry | null | undefined> {
    if (!shouldRefetchEnsExpiry(this.domains[checksummedAddress])) return undefined

    const nameWrapperAddress =
      this.#defaultNetworksMode === 'mainnet' ? ENS_NAME_WRAPPER : ENS_NAME_WRAPPER_SEPOLIA

    try {
      return await getEnsExpiry(provider, {
        name: ens,
        addresses: { nameWrapper: nameWrapperAddress }
      })
    } catch (e) {
      this.emitError({
        error: e as Error,
        message: `Failed to fetch ENS expiry for ${ens}`,
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
