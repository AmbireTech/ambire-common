import { AddressState } from '../interfaces/domains'

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

export { getAddressFromAddressState, getDomainFromAddressState }
