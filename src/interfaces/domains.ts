type AddressState = {
  fieldValue: string
  udAddress: string
  ensAddress: string
  isDomainResolving: boolean
}

type AddressStateOptional = {
  fieldValue?: AddressState['fieldValue']
  ensAddress?: AddressState['ensAddress']
  udAddress?: AddressState['udAddress']
  isDomainResolving?: AddressState['isDomainResolving']
}

type CachedResolvedDomain = {
  name: string
  address: string
  type: 'ens' | 'ud'
}

export type { AddressState, AddressStateOptional, CachedResolvedDomain }
