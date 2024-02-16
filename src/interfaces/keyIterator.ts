import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'

export interface KeyIterator {
  // TODO: maybe add type in here
  /** The wallet native SDK instance, if any exists */
  walletSDK?: any
  retrieve: (
    fromToArr: { from: number; to: number }[],
    derivation?: HD_PATH_TEMPLATE_TYPE
  ) => Promise<string[]>
}
