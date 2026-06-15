import { getAddress, isAddress } from 'ethers'

import { Domains, IDomainsController, ReverseLookupOptions } from '../../interfaces/domains'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { RPCProviders } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import {
  getEnsAvatar,
  getIsNamoshiDomain,
  resolveENSDomain,
  reverseLookupEns,
  ReverseLookupResult
} from '../../services/ensDomains'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

// 15 minutes
export const PERSIST_DOMAIN_FOR_IN_MS = 15 * 60 * 1000
export const PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS = 5 * 60 * 1000 // 5 minutes
const MAX_ENTRIES = 200
const MAX_ENTRY_AGE_IN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class DomainsController extends EventEmitter implements IDomainsController {
  #providers: RPCProviders = {}

  #defaultNetworksMode: 'mainnet' | 'testnet' = 'mainnet'

  #storage?: IStorageController

  #featureFlags?: IFeatureFlagsController

  initialLoadPromise: Promise<void>

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

  #reverseLookupPromises: { [address: string]: Promise<void> | undefined } = {}

  constructor({
    eventEmitterRegistry,
    providers,
    defaultNetworksMode,
    storage,
    featureFlags
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    providers: RPCProviders
    defaultNetworksMode?: 'mainnet' | 'testnet'
    // Not needed for rewards/benzin as they are used for persistence and privacy opt-outs,
    // which are not relevant there
    storage?: IStorageController
    featureFlags?: IFeatureFlagsController
  }) {
    super(eventEmitterRegistry)

    this.#providers = providers
    if (defaultNetworksMode) this.#defaultNetworksMode = defaultNetworksMode
    this.#storage = storage
    this.#featureFlags = featureFlags

    this.initialLoadPromise = this.#load()
  }

  async #load(): Promise<void> {
    if (!this.#storage) return

    const domainsFromStorage = await this.#storage.get('domainsCache', {})

    // Clean older than 7 days, empty entries and keep a maximum of 200 entries to avoid
    // exposing a huge amount of state to the UI that may be stale (e.g., the Humanizer requested and address
    // a month ago for one transaction, but the extension keeps it in state and sends it to the UI every time)
    const sevenDaysAgo = Date.now() - MAX_ENTRY_AGE_IN_MS
    const cleanedDomains = Object.fromEntries(
      Object.entries(domainsFromStorage)
        .filter(([, data]) => {
          if (!data) return false

          const isEmpty = !data.ens && !data.namoshi
          const isTooOld = (data.updatedAt || 0) < sevenDaysAgo

          return !isEmpty && !isTooOld
        })
        .sort(([, a], [, b]) => (b?.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, MAX_ENTRIES)
    )

    this.domains = cleanedDomains

    this.emitUpdate()
  }

  get #keepEnsProfilesUpToDate() {
    return !!this.#featureFlags?.isFeatureEnabled('keepEnsProfilesUpToDate')
  }

  async #persistDomains() {
    if (!this.#storage) return

    await this.#storage.set('domainsCache', this.domains)
  }

  async batchReverseLookup(addresses: string[]) {
    await this.initialLoadPromise
    const normalizedAddresses = this.#normalizeAddresses(addresses)
    const addressesToLookup = this.#getAddressesToLookup(normalizedAddresses)

    if (addressesToLookup.length) {
      const batchPromise = this.#reverseLookup(addressesToLookup, false).finally(() => {
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
    await this.initialLoadPromise

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
    await this.forceEmitUpdate()

    if (this.domainToAddresses[domain]) {
      this.resolveDomainsStatus[domain] = 'RESOLVED'
      await this.forceEmitUpdate()
      this.resolveDomainsStatus[domain] = undefined
      return
    }

    await resolveENSDomain({
      provider: provider,
      domain,
      options: { isNamoshiDomain }
    })
      .then(async ({ address, avatar }) => {
        if (address) {
          this.domainToAddresses[domain] = {
            address: getAddress(address),
            type: isNamoshiDomain ? 'namoshi' : 'ens'
          }
          this.#saveResolvedDomain({
            address,
            ensAvatar: avatar,
            domain,
            type: isNamoshiDomain ? 'namoshi' : 'ens'
          })
          await this.#persistDomains()
        }
        this.resolveDomainsStatus[domain] = 'RESOLVED'
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
      })
      .catch(async (e) => {
        console.error(`Failed to resolve ENS domain: ${domain}`, e)
        this.resolveDomainsStatus[domain] = 'FAILED'
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
    domain,
    type
  }: {
    address: string
    domain: string
    ensAvatar: string | null
    type: 'ens' | 'namoshi'
  }) {
    const checksummedAddress = getAddress(address)
    const { ens: prevEns } = this.domains[checksummedAddress] || { ens: null }

    const existing = this.domains[checksummedAddress]
    const now = Date.now()

    this.domains[checksummedAddress] = {
      ensAvatar: type === 'ens' ? ensAvatar : (existing?.ensAvatar ?? null),
      ens: type === 'ens' ? domain : prevEns,
      namoshi: type === 'namoshi' ? domain : (existing?.namoshi ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
  }

  async reverseLookup(address: string, emitUpdate = true, opts?: ReverseLookupOptions) {
    await this.initialLoadPromise

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
      emitUpdate
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
  async #reverseLookup(addressesToLookup: string[], emitUpdate = true) {
    await this.initialLoadPromise

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

      // Avatars can't be resolved in a batch because there is additional handling
      // for NFT/ipfs avatars. It's not that big of a deal anyway, because most accounts
      // won't have ENS names
      const avatarEntries = await Promise.all(
        resolved.map(async (entry) => {
          if (entry.failed) return [entry.address, null] as const

          const ensName = entry.ens
          if (ensName) {
            const avatar = await withTimeout(() => getEnsAvatar(ensName, ethereumProvider), {
              timeoutMs: 15000
            }).catch(() => null)
            return [entry.address, avatar] as const
          }

          const namoshiName = entry.namoshi
          if (namoshiName && citreaProvider) {
            const avatar = await withTimeout(
              () => getEnsAvatar(namoshiName, citreaProvider, { isNamoshiDomain: true }),
              { timeoutMs: 15000 }
            ).catch(() => null)
            return [entry.address, avatar] as const
          }

          return [entry.address, null] as const
        })
      )
      const avatarByAddress = Object.fromEntries(avatarEntries)

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
        this.domains[address] = {
          ens,
          namoshi,
          ensAvatar: avatarByAddress[address] ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        }
      }
    } catch (e: any) {
      console.warn('reverse ENS/Namoshi lookup failed', e)

      addressesToLookup.forEach((address) => this.#setLookupFailure(address))
    } finally {
      this.loadingAddresses = this.loadingAddresses.filter(
        (loadingAddress) => !addressesToLookup.includes(loadingAddress)
      )

      await this.#persistDomains()

      if (emitUpdate) this.emitUpdate()
    }
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
