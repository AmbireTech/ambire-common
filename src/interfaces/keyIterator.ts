import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'

export interface KeyIterator {
  retrieve: (from: number, to: number, derivation?: HD_PATH_TEMPLATE_TYPE) => Promise<string[]>
}
