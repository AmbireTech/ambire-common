export interface Gas {
  maxFeePerGas: `0x${string}`
  maxPriorityFeePerGas: `0x${string}`
}

export interface GasSpeeds {
  slow: Gas
  medium: Gas
  fast: Gas
  ape: Gas
}
