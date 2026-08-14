import { AddressState, Domains } from '../interfaces/domains'
import { getAddressCaught } from './getAddressCaught'

const getAddressFromAddressState = (
  addressState: Pick<AddressState, 'resolvedAddress' | 'fieldValue'>
) => {
  return (addressState.resolvedAddress || addressState.fieldValue || '').trim()
}

const getDomainFromAddressState = (
  addressState: Pick<AddressState, 'resolvedAddressType' | 'fieldValue'>
) => {
  if (!addressState.resolvedAddressType) return undefined

  const normalized = addressState.fieldValue.toLowerCase().trim()

  return !!normalized ? normalized : undefined
}

/**
 * Finds the normalized domain name matching the address state's resolved address and service type, if any.
 */
const getResolvedDomainName = (
  domains: Domains,
  addressState: Pick<AddressState, 'resolvedAddress' | 'resolvedAddressType'>
): string | undefined => {
  const { resolvedAddress, resolvedAddressType } = addressState
  if (!resolvedAddress || !resolvedAddressType) return undefined

  return domains[getAddressCaught(resolvedAddress)]?.names?.[resolvedAddressType] ?? undefined
}

export { getAddressFromAddressState, getDomainFromAddressState, getResolvedDomainName }
