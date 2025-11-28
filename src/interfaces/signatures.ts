import { Hex } from './hex'
import { SignUserOperation } from './userOperation'

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
  chainId: Hex
  userOp: SignUserOperation
}
