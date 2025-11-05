import { AddressState, IDomainsController } from '../interfaces/domains'

const getAddressFromAddressState = (addressState: AddressState) => {
  return (addressState.ensAddress || addressState.fieldValue || '').trim()
}

const findAccountDomainFromPartialDomain = (
  address: string,
  search: string,
  domains: IDomainsController['domains']
) => {
  const normalizedSearch = search.toLowerCase().trim()
  const domainsEntry = domains[address]
  const normalizedDomain = domainsEntry?.ens?.toLowerCase()?.trim()

  if (!normalizedDomain) return undefined

  // Split search query by whitespace to allow matching multiple words
  const searchWords = normalizedSearch.split(/\s+/).filter((word) => word.length > 0)
  if (searchWords.length === 0) return undefined

  // Check if any of the search words are found in the domain
  // This allows matching "elmo legend" against "elmothelegend.eth" and "elmo.eth"
  return searchWords.some((word) => normalizedDomain.includes(word))
}

export { getAddressFromAddressState, findAccountDomainFromPartialDomain }
