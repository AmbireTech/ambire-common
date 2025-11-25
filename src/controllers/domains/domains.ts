import { getAddress, isAddress } from 'ethers'

import { IDomainsController } from '../../interfaces/domains'
import { RPCProviders } from '../../interfaces/provider'
import { getEnsAvatar, reverseLookupEns } from '../../services/ensDomains'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

interface Domains {
  [address: string]: {
    ens: string | null
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

  domains: Domains = {}

  loadingAddresses: string[] = []

  #reverseLookupPromises: { [address: string]: Promise<void> | undefined } = {}

  constructor(providers: RPCProviders, defaultNetworksMode?: 'mainnet' | 'testnet') {
    super()
    this.#providers = providers
    if (defaultNetworksMode) this.#defaultNetworksMode = defaultNetworksMode
  }

  async batchReverseLookup(addresses: string[]) {
    const filteredAddresses = addresses.filter((address) => isAddress(address))
    await Promise.all(filteredAddresses.map((address) => this.reverseLookup(address, false)))

    this.emitUpdate()
  }

  /**
   *Saves an already resolved ENS name for an address.
   */
  saveResolvedReverseLookup({
    address,
    ensAvatar,
    name,
    type
  }: {
    address: string
    name: string
    ensAvatar: string | null
    type: 'ens'
  }) {
    const checksummedAddress = getAddress(address)
    const { ens: prevEns } = this.domains[checksummedAddress] || { ens: null }

    const existing = this.domains[checksummedAddress]
    const now = Date.now()
    this.domains[checksummedAddress] = {
      ensAvatar: type === 'ens' ? ensAvatar : existing?.ensAvatar ?? null,
      ens: type === 'ens' ? name : prevEns,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    this.emitUpdate()
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
      let ensAvatar: string | undefined | null

      const ens = await withTimeout(() => reverseLookupEns(checksummedAddress, ethereumProvider))

      if (ens) {
        // We need the ens name to resolve the avatar
        ensAvatar = await withTimeout(() => getEnsAvatar(ens, ethereumProvider))
      }

      const now = Date.now()
      const existing = this.domains[checksummedAddress]
      this.domains[checksummedAddress] = {
        ens,
        ensAvatar,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
    } catch (e: any) {
      // Fail silently with a console error, no biggie, since that would get retried
      console.warn('reverse ENS lookup failed', e)

      const hasBeenResolvedOnce = !!this.domains[checksummedAddress]?.createdAt
      if (hasBeenResolvedOnce) {
        this.domains[checksummedAddress].updateFailedAt = Date.now()
      } else {
        this.domains[checksummedAddress] = { ens: null, updateFailedAt: Date.now() }
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
