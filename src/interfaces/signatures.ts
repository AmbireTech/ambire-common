import { Hex } from './hex'

export interface EIP7702Signature {
  yParity: Hex
  r: Hex
  s: Hex
}
