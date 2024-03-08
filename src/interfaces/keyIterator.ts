import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
import { SelectedAccountForImport } from './account'
import { Key } from './keystore'

export interface KeyIterator {
  type: Key['type']
  subType?: 'seed' | 'private-key'
  /** The wallet native SDK instance, if any exists */
  walletSDK?: any
  /** Retrieves the the public addresses (accounts) from specific indexes */
  retrieve: (
    fromToArr: { from: number; to: number }[],
    derivation?: HD_PATH_TEMPLATE_TYPE
  ) => Promise<string[]>
  /** Retrieves the private keys (optional, for hot wallets only) */
  retrieveInternalKeys?: (
    selectedAccountsForImport: SelectedAccountForImport[],
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
  ) => { privateKey: string; dedicatedToOneSA: boolean }[]
}
