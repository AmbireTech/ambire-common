import { getAddress, isAddress } from 'ethers'

import { RPCProviders } from '../../interfaces/provider'
import { reverseLookupEns } from '../../services/ensDomains'
import EventEmitter from '../eventEmitter/eventEmitter'

interface Domains {
  [address: string]: {
    ens: string | null
    savedAt: number
  }
}

// 15 minutes
const PERSIST_DOMAIN_FOR_IN_MS = 15 * 60 * 1000

/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class DomainsController extends EventEmitter {
  #providers: RPCProviders = {}

  #defaultNetworksMode: 'mainnet' | 'testnet' = 'mainnet'

  domains: Domains = {}

  loadingAddresses: string[] = []

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
    name,
    type
  }: {
    address: string
    name: string
    type: 'ens'
  }) {
    const checksummedAddress = getAddress(address)
    const { ens: oldEns } = this.domains[checksummedAddress] || { ens: null }

    this.domains[checksummedAddress] = {
      ens: type === 'ens' ? name : oldEns,
      savedAt: Date.now()
    }
    this.emitUpdate()
  }

  /**
   * Resolves the ENS names for an address if such exist.
   */
  async reverseLookup(address: string, emitUpdate = true) {
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
    const isAlreadyResolved = !!this.domains[checksummedAddress]
    const isExpired =
      isAlreadyResolved &&
      Date.now() - this.domains[checksummedAddress].savedAt > PERSIST_DOMAIN_FOR_IN_MS

    if ((isAlreadyResolved && !isExpired) || this.loadingAddresses.includes(checksummedAddress))
      return

    this.loadingAddresses.push(checksummedAddress)
    this.emitUpdate()

    let ensName = null

    try {
      ensName = (await reverseLookupEns(checksummedAddress, ethereumProvider)) || null
    } catch (e) {
      console.error('ENS reverse lookup unexpected error', e)
    }

    this.domains[checksummedAddress] = {
      ens: ensName,
      savedAt: Date.now()
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
