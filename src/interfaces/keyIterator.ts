import { SelectedAccount } from 'controllers/accountAdder/accountAdder'

import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
import { Key } from './keystore'

export interface KeyIterator {
  type: Key['type']
  subType?: 'seed' | 'private-key'
  /** The wallet native SDK instance, if any exists */
  walletSDK?: any
  retrieve: (
    fromToArr: { from: number; to: number }[],
    derivation?: HD_PATH_TEMPLATE_TYPE
  ) => Promise<string[]>
  // TODO: Implement for internal AND external keys both
  retrievePrivateKeys: (
    selectedAccountsForImport: SelectedAccount[],
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
  ) => { privateKey: string; dedicatedToOneSA: boolean }[]
}
