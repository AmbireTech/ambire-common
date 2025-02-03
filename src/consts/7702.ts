import { Hex } from '../interfaces/hex'

// for networks that don't have a singleton
export const PECTRA_7702 = '0x7b829de68DA4B1C7f75b88061CaF530A2b56fF7e'
export const ODYSSEY_7702 = '0xd5E2Da9f0Fe3F7A074D5ADD6FedCF383209d91FE'

export interface Custom7702Settings {
  [chainId: string]: {
    implementation: Hex
  }
}

export const networks7702: Custom7702Settings = {
  // pectra
  '7088110746': {
    implementation: PECTRA_7702
  },
  // odyssey
  '911867': {
    implementation: ODYSSEY_7702
  }
}
