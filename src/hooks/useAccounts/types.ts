import { UseStorageType } from '../useStorage'
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
  cloudBackupOptout?: boolean
  downloadedBackup?: boolean
}

export interface UseAccountsProps {
  onAdd: (opts: OnAddAccountOptions) => void
  onRemoveLastAccount: () => void
  onRemoveAccountWithoutBackingItUp?: () => void
  useStorage: UseStorageType
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

export interface SignedMessageType {
  accountId: Account['id']
  dApp: {
    name: string
    description: string
    url: string
    icons: string[]
  },
  date: number
  message: string
  networkId: number
  signature: string
  signer: Account['signer']
  typed: boolean
}
