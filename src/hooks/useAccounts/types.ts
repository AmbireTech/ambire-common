import { UseStorageProps, UseStorageReturnType } from '../useStorage'
import { UseToastsReturnType } from '../useToasts'

export type OnAddAccountOptions = {
  shouldRedirect?: boolean
  isNew?: boolean
  select?: boolean
}

export type Account = {
  baseIdentityAddr: string
  bytecode: string
  email: string
  id: string
  identityFactoryAddr: string
  primaryKeyBackup: string
  salt: string
  signer: {
    one: string
    quickAccManager: string
    timelock: number
    two: string
    // Sometimes passed as an extra prop
    address?: string
  }
}

export interface UseAccountsProps {
  onAdd: (opts: OnAddAccountOptions) => void
  onRemoveLastAccount: () => void
  useStorage: (p: Omit<UseStorageProps, 'storage'>) => UseStorageReturnType
  useToasts: () => UseToastsReturnType
}

export interface UseAccountsReturnType {
  accounts: Account[]
  account: Account | {}
  selectedAcc: string
  onSelectAcc: (accountId: Account['id']) => void
  onAddAccount: (acc: Account, opts: OnAddAccountOptions) => void
  onRemoveAccount: (accountId: Account['id']) => void
}
