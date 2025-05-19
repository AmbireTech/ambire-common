import { DomainsController } from '../controllers/domains/domains'
import { AddressState } from '../interfaces/domains'

const getAddressFromAddressState = (addressState: AddressState) => {
  return (addressState.ensAddress || addressState.fieldValue || '').trim()
}

const findAccountDomainFromPartialDomain = (
  address: string,
  search: string,
  domains: DomainsController['domains']
) => {
  const lowercaseSearch = search.toLowerCase()
  const domainsEntry = domains[address]

  return domainsEntry?.ens?.toLowerCase().includes(lowercaseSearch)
}

export { getAddressFromAddressState, findAccountDomainFromPartialDomain }
