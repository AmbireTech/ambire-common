import { getAddress, isAddress } from 'ethers'

import { RPCProviders } from '../../interfaces/provider'
import { reverseLookupEns } from '../../services/ensDomains'
// import { reverseLookupUD } from '../../services/unstoppableDomains'
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

// const EXPECTED_UD_ERROR_MESSAGES = [
//   'Only absolute URLs are supported',
//   'unexpected character at line 1 column 1 of the JSON data',
//   'Unexpected token'
// ]

/**
 * Domains controller- responsible for handling the reverse lookup of addresses to ENS and UD names.
 * Resolved names are saved in `domains` for a short period of time(15 minutes) to avoid unnecessary lookups.
 */
export class DomainsController extends EventEmitter {
  #providers: RPCProviders = {}

  domains: Domains = {}

  loadingAddresses: string[] = []

  constructor(providers: RPCProviders) {
    super()
    this.#providers = providers
  }

  async batchReverseLookup(addresses: string[]) {
    const filteredAddresses = addresses.filter((address) => isAddress(address))
    await Promise.all(filteredAddresses.map((address) => this.reverseLookup(address, false)))

    this.emitUpdate()
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
  async reverseLookup(address: string, emitUpdate = true) {
    if (!('1' in this.#providers)) {
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
      ensName = (await reverseLookupEns(checksummedAddress, this.#providers['1'])) || null
    } catch (e) {
      console.error('ENS reverse lookup unexpected error', e)
    }

    // Don't reverse lookup UD names for now
    // https://github.com/AmbireTech/ambire-app/issues/2681#issuecomment-2299460748
    // If UD is ever needed, rewrite using Promise.all
    // try {
    //   udName = (await reverseLookupUD(checksummedAddress)) || null
    // } catch (e: any) {
    //   if (
    //     !EXPECTED_UD_ERROR_MESSAGES.some((expectedMessage) => e.message.includes(expectedMessage))
    //   ) {
    //     console.error('UD reverse lookup unexpected error', e)
    //   }
    // }

    this.domains[checksummedAddress] = {
      ens: ensName,
      ud: null,
      savedAt: Date.now()
    }

    this.loadingAddresses = this.loadingAddresses.filter(
      (loadingAddress) => loadingAddress !== checksummedAddress
    )

    if (emitUpdate) this.emitUpdate()
  }
}
