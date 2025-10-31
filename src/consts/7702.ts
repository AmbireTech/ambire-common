import { Hex } from '../interfaces/hex'
import { EIP_7702_AMBIRE_ACCOUNT, EIP_7702_GRID_PLUS, EIP_7702_KATANA } from './deploy'

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
  },
  // katana, they don't have the singleton
  '747474': {
    implementation: EIP_7702_KATANA
  }
}

export const eip7702AmbireContracts = [
  EIP_7702_AMBIRE_ACCOUNT,
  EIP_7702_KATANA,
  EIP_7702_GRID_PLUS
]

export interface EIP7702Auth {
  address: Hex
  chainId: Hex
  nonce: Hex
  r: Hex
  s: Hex
  v: Hex
  yParity: Hex
}
