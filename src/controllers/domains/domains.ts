import { getAddress } from 'ethers'

import { RPCProviders } from '../../interfaces/provider'
import { reverseLookupEns } from '../../services/ensDomains'
import { reverseLookupUD } from '../../services/unstoppableDomains'
import EventEmitter from '../eventEmitter/eventEmitter'

interface Domains {
  [address: string]: {
    ens: string | null
    ud: string | null
    savedAt: number
  }
}

// 15 minutes
const PERSIST_DOMAIN_FOR_IN_MS = 15 * 60 * 1000

/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS and UD names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class DomainsController extends EventEmitter {
  #providers: RPCProviders = {}

  #fetch: Function

  domains: Domains = {}

  loadingAddresses: string[] = []

  constructor(providers: RPCProviders, fetch: Function) {
    super()
    this.#providers = providers
    this.#fetch = fetch
  }

  /**
   *Saves an already resolved ENS or UD name for an address.
   */
  saveResolvedReverseLookup({
    address,
    name,
    type
  }: {
    address: string
    name: string
    type: 'ens' | 'ud'
  }) {
    const checksummedAddress = getAddress(address)
    const { ens: oldEns, ud: oldUd } = this.domains[checksummedAddress] || { ens: null, ud: null }

    this.domains[checksummedAddress] = {
      ens: type === 'ens' ? name : oldEns,
      ud: type === 'ud' ? name : oldUd,
      savedAt: Date.now()
    }
    this.emitUpdate()
  }

  /**
   * Resolves the ENS and UD names for an address if such exist.
   */
  async reverseLookup(address: string) {
    if (!('ethereum' in this.#providers)) {
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
    let udName = null

    try {
      ensName = (await reverseLookupEns(checksummedAddress, this.#providers.ethereum)) || null
    } catch (e) {
      console.error('ENS reverse lookup unexpected error', e)
    }

    try {
      udName = (await reverseLookupUD(checksummedAddress)) || null
    } catch (e: any) {
      if (!e?.message?.includes('Only absolute URLs are supported')) {
        console.error('UD reverse lookup unexpected error', e)
      }
    }

    this.domains[checksummedAddress] = {
      ens: ensName,
      ud: udName,
      savedAt: Date.now()
    }

    this.loadingAddresses = this.loadingAddresses.filter(
      (loadingAddress) => loadingAddress !== checksummedAddress
    )

    this.emitUpdate()
  }
}
