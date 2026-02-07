import { getAddress, isAddress } from 'ethers'
import { createWnsClient, isWei } from 'wns-utils'
import type { WnsClient } from 'wns-utils'

import { IDomainsController } from '../../interfaces/domains'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { RPCProviders } from '../../interfaces/provider'
import { getEnsAvatar, resolveENSDomain, reverseLookupEns } from '../../services/ensDomains'
import { resolveWNSDomain, reverseResolveWNS } from '../../services/wnsDomains'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

interface Domains {
  [address: string]: {
    ens: string | null
    wns: string | null
    ensAvatar?: string | null
    createdAt?: number
    updatedAt?: number
    updateFailedAt?: number
  }
}

// 15 minutes
export const PERSIST_DOMAIN_FOR_IN_MS = 15 * 60 * 1000
export const PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class DomainsController extends EventEmitter implements IDomainsController {
  #providers: RPCProviders = {}

  #defaultNetworksMode: 'mainnet' | 'testnet' = 'mainnet'

  #wnsClient: WnsClient | null = null

  /** Stores ENS names, avatars, and metadata (timestamps) indexed by account address */
  domains: Domains = {}

  /** Maps domain names to account addresses; necessary because the 'domains' state
   * only indexes by address, making getting an address for an existing domain name inefficient.
   */
  ensToAddress: { [ensName: string]: string } = {}

  wnsToAddress: { [wnsName: string]: string } = {}

  loadingAddresses: string[] = []

  resolveDomainsStatus: { [domain: string]: 'LOADING' | 'RESOLVED' | 'FAILED' | undefined } = {}

  #reverseLookupPromises: { [address: string]: Promise<void> | undefined } = {}

  constructor({
    eventEmitterRegistry,
    providers,
    defaultNetworksMode
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    providers: RPCProviders
    defaultNetworksMode?: 'mainnet' | 'testnet'
  }) {
    super(eventEmitterRegistry)

    this.#providers = providers
    if (defaultNetworksMode) this.#defaultNetworksMode = defaultNetworksMode
  }

  #getWnsClient(): WnsClient | null {
    if (this.#wnsClient) return this.#wnsClient

    const ethereumProvider =
      this.#providers[this.#defaultNetworksMode === 'mainnet' ? '1' : '11155111']

    if (!ethereumProvider) return null

    // eslint-disable-next-line no-underscore-dangle
    const rpcUrl = ethereumProvider._getConnection().url
    this.#wnsClient = createWnsClient({ rpc: rpcUrl })

    return this.#wnsClient
  }

  async batchReverseLookup(addresses: string[]) {
    const filteredAddresses = addresses.filter((address) => isAddress(address))
    await Promise.all(filteredAddresses.map((address) => this.reverseLookup(address, false)))

    this.emitUpdate()
  }

  /**
   * Resolves an ENS domain and persists it to state only if resolution succeeds.
   */
  async resolveDomain({ domain, bip44Item }: { domain: string; bip44Item?: number[][] }) {
    const ethereumProvider =
      this.#providers[this.#defaultNetworksMode === 'mainnet' ? '1' : '11155111']

    if (!ethereumProvider) {
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

    if (this.ensToAddress[domain] || this.wnsToAddress[domain]) {
      this.resolveDomainsStatus[domain] = 'RESOLVED'
      await this.forceEmitUpdate()
      this.resolveDomainsStatus[domain] = undefined
      return
    }

    if (isWei(domain)) {
      const wnsClient = this.#getWnsClient()
      if (!wnsClient) {
        this.resolveDomainsStatus[domain] = 'FAILED'
        await this.forceEmitUpdate()
        this.resolveDomainsStatus[domain] = undefined
        return
      }

      await resolveWNSDomain({ domain, wnsClient })
        .then(async ({ address }) => {
          if (address) {
            this.#saveResolvedDomain({ address, ensAvatar: null, domain, type: 'wns' })
          }
          this.resolveDomainsStatus[domain] = 'RESOLVED'
          await this.forceEmitUpdate()
          this.resolveDomainsStatus[domain] = undefined
        })
        .catch(async (e) => {
          console.error(`Failed to resolve WNS domain: ${domain}`, e)
          this.resolveDomainsStatus[domain] = 'FAILED'
          await this.forceEmitUpdate()
          this.resolveDomainsStatus[domain] = undefined
        })
    } else {
      await resolveENSDomain({
        domain,
        bip44Item,
        getResolver: (name) => ethereumProvider.getResolver(name)
      })
        .then(async ({ address, avatar }) => {
          if (address) {
            this.#saveResolvedDomain({ address, ensAvatar: avatar, domain, type: 'ens' })
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
    type: 'ens' | 'wns'
  }) {
    const checksummedAddress = getAddress(address)
    const existing = this.domains[checksummedAddress]
    const now = Date.now()

    if (type === 'wns') {
      this.wnsToAddress[domain] = checksummedAddress
    } else {
      this.ensToAddress[domain] = checksummedAddress
    }

    this.domains[checksummedAddress] = {
      ensAvatar: type === 'ens' ? ensAvatar : (existing?.ensAvatar ?? null),
      ens: type === 'ens' ? domain : (existing?.ens ?? null),
      wns: type === 'wns' ? domain : (existing?.wns ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
  }

  async reverseLookup(address: string, emitUpdate = true) {
    if (this.#reverseLookupPromises[address]) {
      await this.#reverseLookupPromises[address]

      return
    }

    this.#reverseLookupPromises[address] = this.#reverseLookup(address, emitUpdate).finally(() => {
      this.#reverseLookupPromises[address] = undefined
    })

    await this.#reverseLookupPromises[address]
  }

  /**
   * Resolves the ENS names for an address if such exist.
   */
  async #reverseLookup(address: string, emitUpdate = true) {
    const ethereumProvider =
      this.#providers[this.#defaultNetworksMode === 'mainnet' ? '1' : '11155111']

    if (!ethereumProvider) {
      this.emitError({
        error: new Error('domains.reverseLookup: Ethereum provider is not available'),
        message: 'The RPC provider for Ethereum is not available.',
        level: 'major'
      })
      return
    }
    const checksummedAddress = getAddress(address)

    const hasLastUpdateFailed = !!this.domains[checksummedAddress]?.updateFailedAt

    const hasExpired = hasLastUpdateFailed
      ? Date.now() - (this.domains[checksummedAddress]?.updateFailedAt ?? 0) >
        PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS
      : Date.now() - (this.domains[checksummedAddress]?.updatedAt ?? 0) > PERSIST_DOMAIN_FOR_IN_MS

    if (!hasExpired || this.loadingAddresses.includes(checksummedAddress)) return

    this.loadingAddresses.push(checksummedAddress)
    this.emitUpdate()

    try {
      const wnsClient = this.#getWnsClient()

      const [ens, wns] = await Promise.all([
        withTimeout(() => reverseLookupEns(checksummedAddress, ethereumProvider)),
        wnsClient
          ? withTimeout(() => reverseResolveWNS(checksummedAddress, wnsClient)).catch(() => null)
          : Promise.resolve(null)
      ])

      let ensAvatar: string | undefined | null
      if (ens) {
        // We need the ens name to resolve the avatar
        ensAvatar = await withTimeout(() => getEnsAvatar(ens, ethereumProvider))
        this.ensToAddress[ens] = checksummedAddress
      }

      if (wns) {
        this.wnsToAddress[wns] = checksummedAddress
      }

      const now = Date.now()
      const existing = this.domains[checksummedAddress]
      this.domains[checksummedAddress] = {
        ens,
        wns,
        ensAvatar,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
    } catch (e: any) {
      // Fail silently with a console error, no biggie, since that would get retried
      console.warn('reverse ENS lookup failed', e)

      const hasBeenResolvedOnce = !!this.domains[checksummedAddress]?.createdAt
      if (hasBeenResolvedOnce) {
        this.domains[checksummedAddress]!.updateFailedAt = Date.now()
      } else {
        this.domains[checksummedAddress] = { ens: null, wns: null, updateFailedAt: Date.now() }
      }
    }

    this.loadingAddresses = this.loadingAddresses.filter(
      (loadingAddress) => loadingAddress !== checksummedAddress
    )

    if (emitUpdate) this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
