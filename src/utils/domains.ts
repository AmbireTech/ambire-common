import { AddressState } from '../interfaces/domains'

const getAddressFromAddressState = (
  addressState: Pick<AddressState, 'resolvedAddress' | 'fieldValue'>
) => {
  return (addressState.resolvedAddress || addressState.fieldValue || '').trim()
}

export { getAddressFromAddressState }
