import { ControllerInterface } from './controller'

export type IDomainsController = ControllerInterface<
  InstanceType<typeof import('../controllers/domains/domains').DomainsController>
>

export type Domains = {
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

type ReverseLookupOptions = {
  /**
   * Decides when a reverse lookup is allowed to hit the network. Ignored when
   * `keepEnsProfilesUpToDate` is true (the opt-out), which forces `whenStale` everywhere.
   * whenStale - Refresh once the cached value is older than the TTL.
   * ifMissing - Resolve only if the address was never resolved before, then serve from cache forever
   * never - Never trigger a lookup; serve from cache only (used for address lists to avoid linking accounts)
   */
  privacyUpdateMode: 'whenStale' | 'ifMissing' | 'never'
}

type AddressState = {
  fieldValue: string
  resolvedAddress: string
  resolvedAddressType: 'ens' | 'namoshi' | null
  isDomainResolving: boolean
}

type AddressStateOptional = {
  fieldValue?: AddressState['fieldValue']
  resolvedAddress?: AddressState['resolvedAddress']
  resolvedAddressType?: AddressState['resolvedAddressType']
  isDomainResolving?: AddressState['isDomainResolving']
}

export type { AddressState, AddressStateOptional, ReverseLookupOptions }
