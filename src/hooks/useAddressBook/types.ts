import { UseAccountsReturnType } from '../useAccounts'
import { UseStorageType } from '../useStorage'
import { UseToastsReturnType } from '../useToasts'

export type Address = {
  name: string
  address: string
  isUD: boolean
}

export interface UseAddressBookProps {
  useAccounts: () => UseAccountsReturnType
  useStorage: UseStorageType
  useToasts: () => UseToastsReturnType
}

export interface UseAddressBookReturnType {
  addresses: Address[]
  addAddress: (name: Address['name'], address: Address['address'], isUD: Address['isUD']) => void
  removeAddress: (name: Address['name'], address: Address['address'], isUD: Address['isUD']) => void
  isKnownAddress: (address: Address['address']) => boolean
}
