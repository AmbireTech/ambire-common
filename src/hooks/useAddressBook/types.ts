import { UseAccountsReturnType } from '../useAccounts'
import { UseConstantsReturnType } from '../useConstants'
import { UseStorageType } from '../useStorage'
import { UseToastsReturnType } from '../useToasts'

export type Address = {
  name: string
  address: string
  type: 'ens' | 'ud' | 'pub'
}

export interface UseAddressBookProps {
  useConstants: () => UseConstantsReturnType
  useAccounts: () => UseAccountsReturnType
  useStorage: UseStorageType
  useToasts: () => UseToastsReturnType
}

export interface UseAddressBookReturnType {
  addresses: Address[]
  addAddress: (name: Address['name'], address: Address['address'], type: Address['type']) => void
  removeAddress: (name: Address['name'], address: Address['address'], type: Address['type']) => void
  isKnownAddress: (address: Address['address']) => boolean
}
