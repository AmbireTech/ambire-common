import { Hex } from '../interfaces/hex'
import { EIP_7702_AMBIRE_ACCOUNT } from './deploy'

export interface Custom7702Settings {
  [chainId: string]: {
    implementation: Hex
  }
}

export const networks7702: Custom7702Settings = {
  // odyssey
  '911867': {
    implementation: EIP_7702_AMBIRE_ACCOUNT
  },
  // sepolia
  '11155111': {
    implementation: EIP_7702_AMBIRE_ACCOUNT
  }
}

export interface EIP7702Auth {
  address: Hex
  chainId: Hex
  nonce: Hex
  r: Hex
  s: Hex
  v: Hex
  yParity: Hex
}
