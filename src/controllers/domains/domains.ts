import { getAddress, isAddress } from 'ethers'

import { IDomainsController } from '../../interfaces/domains'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { RPCProviders } from '../../interfaces/provider'
import { IVerificationController } from '../../interfaces/verification'
import {
  getEnsAvatar,
  getIsNamoshiDomain,
  resolveENSDomain,
  reverseLookupEns,
  ReverseLookupResult
} from '../../services/ensDomains'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

interface Domains {
  [address: string]: {
    ens: string | null
    /**
     * Namoshi domains are fully compatible with the ENS implementation, they just use a different universal resolver contract
     * and have different TLDs (.btc and .citrea).
     */
    namoshi: string | null
    /**
     * ENS or Namoshi avatar URL
     */
    ensAvatar?: string | null
    createdAt?: number
    updatedAt?: number
    updateFailedAt?: number
  }
}

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

/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class DomainsController extends EventEmitter implements IDomainsController {
  #providers: RPCProviders = {}

  #verification?: IVerificationController

  #defaultNetworksMode: 'mainnet' | 'testnet' = 'mainnet'

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

  #reverseLookupPromises: { [address: string]: Promise<void> | undefined } = {}

  constructor({
    eventEmitterRegistry,
    providers,
    verification,
    defaultNetworksMode
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    providers: RPCProviders
    verification?: IVerificationController
    defaultNetworksMode?: 'mainnet' | 'testnet'
  }) {
    super(eventEmitterRegistry)

    this.#providers = providers
    this.#verification = verification
    if (defaultNetworksMode) this.#defaultNetworksMode = defaultNetworksMode
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
    if (isNamoshiDomain) return

    const verificationProvider = this.#verification?.getReadyProvider(BigInt(providerChainId))
    if (!verificationProvider) return

    const verifiedResult = await withTimeout(
      () =>
        resolveENSDomain({
          provider: verificationProvider,
          domain,
          options: { isNamoshiDomain }
        }),
      { timeoutMs: 15000 }
    )

    if (!verifiedResult.address && !address) return
    if (
      verifiedResult.address &&
      address &&
      getAddress(verifiedResult.address) === getAddress(address)
    ) {
      return
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

  async batchReverseLookup(addresses: string[]) {
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
    await this.forceEmitUpdate()

    if (this.domainToAddresses[domain]) {
      try {
        if (this.domainToAddresses[domain]?.address) {
          await this.#verifyEnsResolution({
            providerChainId,
            domain,
            address: this.domainToAddresses[domain]!.address!,
            isNamoshiDomain
          })
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

    await resolveENSDomain({
      provider: provider,
      domain,
      options: { isNamoshiDomain }
    })
      .then(async ({ address, avatar }) => {
        if (address) {
          await this.#verifyEnsResolution({
            providerChainId,
            domain,
            address,
            isNamoshiDomain
          })

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
        }
        this.resolveDomainsStatus[domain] = 'RESOLVED'
        delete this.resolveDomainsErrors[domain]
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
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

  async reverseLookup(address: string, emitUpdate = true) {
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

    const addressToLookup = this.#getAddressesToLookup([checksummedAddress])[0]

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

  #getAddressesToLookup(addresses: string[]) {
    return this.#normalizeAddresses(addresses).filter((checksummedAddress) => {
      const hasLastUpdateFailed = !!this.domains[checksummedAddress]?.updateFailedAt

      const hasExpired = hasLastUpdateFailed
        ? Date.now() - (this.domains[checksummedAddress]?.updateFailedAt ?? 0) >
          PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS
        : Date.now() - (this.domains[checksummedAddress]?.updatedAt ?? 0) > PERSIST_DOMAIN_FOR_IN_MS

      return (
        hasExpired &&
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
  async #reverseLookup(addresses: string[], emitUpdate = true) {
    if (!addresses.length) return

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

    const addressesToLookup = this.#getAddressesToLookup(addresses)
    if (!addressesToLookup.length) return

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
