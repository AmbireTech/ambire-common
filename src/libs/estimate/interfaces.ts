import { TokenResult } from '../portfolio'

export interface BundlerEstimateResult {
  preVerificationGas: string
  verificationGasLimit: string
  callGasLimit: string
  paymasterVerificationGasLimit: string
  paymasterPostOpGasLimit: string
}

export interface Erc4337GasLimits {
  preVerificationGas: string
  verificationGasLimit: string
  callGasLimit: string
  paymasterVerificationGasLimit: string
  paymasterPostOpGasLimit: string
  gasPrice: {
    slow: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    medium: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    fast: { maxFeePerGas: string; maxPriorityFeePerGas: string }
    ape: { maxFeePerGas: string; maxPriorityFeePerGas: string }
  }
}

export interface FeePaymentOption {
  availableAmount: bigint
  paidBy: string
  gasUsed?: bigint
  addedNative: bigint
  token: TokenResult
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
