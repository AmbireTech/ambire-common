import { AddressState } from '../interfaces/domains'

const getAddressFromAddressState = (addressState: AddressState) => {
  return (addressState.ensAddress || addressState.fieldValue || '').trim()
}

export { getAddressFromAddressState }
