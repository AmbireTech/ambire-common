import { AddressState } from '../interfaces/domains'

const getAddressFromAddressState = (addressState: Omit<AddressState, 'isDomainResolving'>) => {
  return (
    addressState.ensAddress ||
    addressState.namoshiAddress ||
    addressState.fieldValue ||
    ''
  ).trim()
}

export { getAddressFromAddressState }
