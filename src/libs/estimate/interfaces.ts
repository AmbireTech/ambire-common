export interface Erc4337GasLimits {
  preVerificationGas: string
  verificationGasLimit: string
  callGasLimit: string
  gasPrice: {
    slow: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    medium: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    fast: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    ape: { maxFeePerGas: string; maxPriorityFeePerGas: string }
  }
}

export interface EstimateResult {
  gasUsed: bigint
  nonce: number
  feePaymentOptions: {
    availableAmount: bigint
    paidBy: string
    address: string
    gasUsed?: bigint
    addedNative: bigint
    isGasTank: boolean
  }[]
  erc4337GasLimits?: Erc4337GasLimits
  arbitrumL1FeeIfArbitrum: { noFee: bigint; withFee: bigint }
  error: Error | null
}

export interface FeeToken {
  address: string
  isGasTank: boolean
  amount: bigint // how much the user has (from portfolio)
  symbol: string
}
