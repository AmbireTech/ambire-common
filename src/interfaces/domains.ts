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

export type { AddressState, AddressStateOptional }
