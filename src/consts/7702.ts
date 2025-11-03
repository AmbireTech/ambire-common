import { Hex } from '../interfaces/hex'
import { EIP_7702_AMBIRE_ACCOUNT, EIP_7702_GRID_PLUS, EIP_7702_KATANA } from './deploy'

export interface Custom7702Settings {
  [chainId: string]: {
    implementation: Hex
  }
}

export const eip7702AmbireContracts = [EIP_7702_AMBIRE_ACCOUNT, EIP_7702_KATANA, EIP_7702_GRID_PLUS]

export interface EIP7702Auth {
  address: Hex
  chainId: Hex
  nonce: Hex
  r: Hex
  s: Hex
  v: Hex
  yParity: Hex
}
