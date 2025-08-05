import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
import EventEmitter from '../controllers/eventEmitter/eventEmitter'
import { Account, AccountOnPage, SelectedAccountForImport } from './account'
import { KeyIterator } from './keyIterator'
import { ReadyToAddKeys } from './keystore'

export interface IAccountPickerController extends EventEmitter {
  // initParams: {
  //   keyIterator: KeyIterator | null
  //   hdPathTemplate: HD_PATH_TEMPLATE_TYPE
  //   page?: number
  //   pageSize?: number
  //   shouldSearchForLinkedAccounts?: boolean
  //   shouldGetAccountsUsedOnNetworks?: boolean
  //   shouldAddNextAccountAutomatically?: boolean
  // } | null
  keyIterator?: KeyIterator | null
  hdPathTemplate?: HD_PATH_TEMPLATE_TYPE
  isInitialized: boolean
  shouldSearchForLinkedAccounts: boolean
  shouldGetAccountsUsedOnNetworks: boolean
  shouldAddNextAccountAutomatically: boolean
  page: number
  pageSize: number
  pageError: null | string
  selectedAccountsFromCurrentSession: SelectedAccountForImport[]
  readyToAddAccounts: Account[]
  readyToRemoveAccounts: Account[]
  readyToAddKeys: ReadyToAddKeys
  addAccountsStatus: 'LOADING' | 'SUCCESS' | 'INITIAL'
  selectNextAccountStatus: 'LOADING' | 'SUCCESS' | 'INITIAL'
  accountsLoading: boolean
  linkedAccountsLoading: boolean
  networksWithAccountStateError: bigint[]
  addAccountsPromise?: Promise<void>
  findAndSetLinkedAccountsPromise?: Promise<void>
  accountsOnPage: AccountOnPage[]
  allKeysOnPage: string[]
  selectedAccounts: SelectedAccountForImport[]
  addedAccountsFromCurrentSession: Account[]
  setInitParams: (params: {
    keyIterator: KeyIterator | null
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
    page?: number
    pageSize?: number
    shouldSearchForLinkedAccounts?: boolean
    shouldGetAccountsUsedOnNetworks?: boolean
    shouldAddNextAccountAutomatically?: boolean
  }) => void
  init: () => void
  type: 'internal' | 'trezor' | 'ledger' | 'lattice' | undefined
  subType: 'seed' | 'private-key' | 'hw' | undefined
  reset: (resetInitParams?: boolean) => Promise<void>
  resetAccountsSelection: () => void
  setHDPathTemplate: ({
    hdPathTemplate
  }: {
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
  }) => Promise<void>
  selectAccount: (account: Account) => void
  deselectAccount: (account: Account) => void
  retrieveInternalKeysOfSelectedAccounts: (
    internalKeys: {
      addr: string
      type: 'internal'
      label: string
      privateKey: string
      dedicatedToOneSA: boolean
      meta: {
        createdAt: number
      }
    }[]
  ) => void
  isPageLocked: boolean
  setPage: (params: {
    page: number
    pageSize?: number
    shouldSearchForLinkedAccounts?: boolean
    shouldGetAccountsUsedOnNetworks?: boolean
  }) => Promise<void>
  addAccounts: (accounts?: SelectedAccountForImport[]) => Promise<void>
  selectNextAccount: () => Promise<void>
  removeNetworkData(chainId: bigint): void
}
