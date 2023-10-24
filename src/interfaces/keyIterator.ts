import { ExternalKey } from './keystore'

export interface KeyIterator {
  retrieve: (
    from: number,
    to: number,
    derivation?: ExternalKey['meta']['hdPathTemplate']
  ) => Promise<string[]>
}
