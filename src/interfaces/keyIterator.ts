import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
import { Key } from './keystore'

export interface KeyIterator {
  type: Key['type']
  /** The wallet native SDK instance, if any exists */
  walletSDK?: any
  retrieve: (
    fromToArr: { from: number; to: number }[],
    derivation?: HD_PATH_TEMPLATE_TYPE
  ) => Promise<string[]>
}
