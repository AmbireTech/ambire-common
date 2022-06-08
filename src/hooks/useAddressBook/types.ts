import { UseAccountsReturnType } from '../accounts'
import { UseToastsReturnType } from '../toasts'
import { UseStorageProps, UseStorageReturnType } from '../useStorage'

export type Address = {
  name: string
  address: string
  isUD: boolean
}

export interface UseAddressBookProps {
  useAccounts: () => UseAccountsReturnType
  useStorage: (p: Omit<UseStorageProps, 'storage'>) => UseStorageReturnType
  useToasts: () => UseToastsReturnType
}

export interface UseAddressBookReturnTypes {
  addresses: Address[]
  addAddress: (name: Address['name'], address: Address['address'], isUD: Address['isUD']) => void
  removeAddress: (name: Address['name'], address: Address['address'], isUD: Address['isUD']) => void
  isKnownAddress: (address: Address['address']) => boolean
}
