import { NameExpiry } from '../services/ensDomains'
import { NameServiceId, ResolvedNames } from '../services/nameResolvers'
import { ControllerInterface } from './controller'

export type IDomainsController = ControllerInterface<
  InstanceType<typeof import('../controllers/domains/domains').DomainsController>
>

export type Domains = {
  [address: string]: {
    /**
     * Resolved primary names keyed by service. ENS-compatible services share the ENS resolution
     * path with a different universal resolver and TLDs (Namoshi: .btc/.citrea, GNS: .gwei).
     */
    names: ResolvedNames
    /**
     * Avatar of the primary name (ENS, Namoshi and GNS all expose one).
     */
    avatar?: string | null
    createdAt?: number
    updatedAt?: number
    updateFailedAt?: number
    /**
     * Registration expiry of the primary name (only ENS names have one today):
     * - undefined: not fetched yet
     * - a value: fetched; the name has a registration expiry
     * - null: fetched, but not relevant (no expirable primary name / unregistered)
     */
    expiry?: NameExpiry | null
  }
}

export type ResolvedReverseEntry =
  | { address: string; failed: true }
  | { address: string; failed: false; names: ResolvedNames }

export type ExtraReverseData = { avatar: string | null; expiry: NameExpiry | null | undefined }

type ReverseLookupOptions = {
  /**
   * Decides when a reverse lookup is allowed to hit the network. Ignored when
   * `keepEnsProfilesUpToDate` is true (the opt-out), which forces `whenStale` everywhere.
   * whenStale - Refresh once the cached value is older than the TTL.
   * never - Never trigger a lookup; serve from cache only (used for address lists to avoid linking accounts)
   */
  privacyUpdateMode: 'whenStale' | 'never'
  updateExpiry?: boolean
}

type AddressState = {
  fieldValue: string
  resolvedAddress: string
  resolvedAddressType: NameServiceId | null
  isDomainResolving: boolean
}

type AddressStateOptional = {
  fieldValue?: AddressState['fieldValue']
  resolvedAddress?: AddressState['resolvedAddress']
  resolvedAddressType?: AddressState['resolvedAddressType']
  isDomainResolving?: AddressState['isDomainResolving']
}

export type { AddressState, AddressStateOptional, ReverseLookupOptions }
