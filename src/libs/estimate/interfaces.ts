import { TokenResult } from '../portfolio'

export interface BundlerEstimateResult {
  preVerificationGas: string
  verificationGasLimit: string
  callGasLimit: string
  paymasterVerificationGasLimit: string
  paymasterPostOpGasLimit: string
}

export interface BundlerGasPrice {
  slow: { maxFeePerGas: string; maxPriorityFeePerGas: string }
  medium: { maxFeePerGas: string; maxPriorityFeePerGas: string }
  fast: { maxFeePerGas: string; maxPriorityFeePerGas: string }
  ape: { maxFeePerGas: string; maxPriorityFeePerGas: string }
}

export interface Erc4337GasLimits {
  preVerificationGas: string
  verificationGasLimit: string
  callGasLimit: string
  paymasterVerificationGasLimit: string
  paymasterPostOpGasLimit: string
  gasPrice: BundlerGasPrice
}

export interface FeePaymentOption {
  availableAmount: bigint
  paidBy: string
  gasUsed?: bigint
  addedNative: bigint
  token: TokenResult
  isSponsorship?: boolean
}

export interface EstimateResult {
  gasUsed: bigint
  // the nonce should always be the current value of account.nonce()
  // even in ERC-4337 case, we might use the account.nonce() for
  // signatures. We don't need the EntryPoint nonce
  currentAccountNonce: number
  feePaymentOptions: FeePaymentOption[]
  erc4337GasLimits?: Erc4337GasLimits
  // @eip7677
  sponsorship?: Erc4337GasLimits
  error: Error | null
  // put here errors that are not fatal to the signing process
  // but reactable if known
  // example: bundler simulation fails because of incorrect 4337 nonce.
  // The user can still broadcast with EOA but we can also react
  // to this error by setting the correct nonce and re-estimating
  nonFatalErrors?: Error[]
}
