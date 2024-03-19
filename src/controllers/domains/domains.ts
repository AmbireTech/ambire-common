import { getAddress } from 'ethers'

import { RPCProviders } from '../../interfaces/settings'
import { reverseLookupEns } from '../../services/ensDomains'
import { reverseLookupUD } from '../../services/unstoppableDomains'
import EventEmitter from '../eventEmitter/eventEmitter'

interface Domains {
  [address: string]: {
    ens: string | null
    ud: string | null
  }
}

/**
 * Domains controller
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
    this.domains[checksummedAddress] = {
      ens: type === 'ens' ? name : null,
      ud: type === 'ud' ? name : null
    }
    this.emitUpdate()
  }

  async reverseLookup(address: string) {
    if (!('ethereum' in this.#providers)) return
    const checksummedAddress = getAddress(address)

    const isAlreadyResolved = this.domains[checksummedAddress]

    if (isAlreadyResolved || this.loadingAddresses.includes(checksummedAddress)) return

    this.loadingAddresses.push(checksummedAddress)
    this.emitUpdate()

    let ensName = null
    let udName = null

    try {
      ensName =
        (await reverseLookupEns(checksummedAddress, this.#providers.ethereum, this.#fetch)) || null
    } catch (e) {
      console.error('ENS reverse lookup unexpected error', e)
    }

    try {
      udName = (await reverseLookupUD(checksummedAddress)) || null
    } catch (e) {
      console.error('UD reverse lookup unexpected error', e)
    }

    this.domains[checksummedAddress] = {
      ens: ensName,
      ud: udName
    }

    this.loadingAddresses = this.loadingAddresses.filter(
      (loadingAddress) => loadingAddress !== checksummedAddress
    )

    this.emitUpdate()
  }
}
