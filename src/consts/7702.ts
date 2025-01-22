import { Hex } from '../interfaces/hex'

// as pectra doesn't have the singleton, we're using a custom address for it
export const PECTRA_7702 = '0x7b829de68DA4B1C7f75b88061CaF530A2b56fF7e'

export interface Custom7702Settings {
  [chainId: string]: {
    implementation: Hex
  }
}

export const networks7702: Custom7702Settings = {
  // pectra
  '7088110746': {
    implementation: PECTRA_7702
  }
}
