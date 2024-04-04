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

export interface ArbitrumL1Fee {
  noFee: bigint
  withFee: bigint
}

export interface FeePaymentOption {
  availableAmount: bigint
  paidBy: string
  address: string
  gasUsed?: bigint
  addedNative: bigint
  isGasTank: boolean
}

export interface EstimateResult {
  gasUsed: bigint
  // the nonce should always be the current value of account.nonce()
  // even in ERC-4337 case, we might use the account.nonce() for
  // signatures. We don't need the EntryPoint nonce
  currentAccountNonce: number
  feePaymentOptions: FeePaymentOption[]
  erc4337GasLimits?: Erc4337GasLimits
  error: Error | null
}

export interface FeeToken {
  address: string
  isGasTank: boolean
  amount: bigint // how much the user has (from portfolio)
  symbol: string
}
