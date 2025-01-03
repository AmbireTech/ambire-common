import { Hex } from '../../interfaces/hex'

export interface Gas {
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
}

export interface GasSpeeds {
  slow: Gas
  medium: Gas
  fast: Gas
  ape: Gas
}
