import { Hex } from './hex'

export interface EIP7702Signature {
  yParity: Hex
  r: Hex
  s: Hex
}

export interface PlainSignature {
  yParity: Hex
  r: Hex
  s: Hex
}

export interface EILSignature {
  initCode?: string
  eip7702Auth?: string
  signature: string
}
