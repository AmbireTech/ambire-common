import { Hex } from '../../interfaces/hex'
import { GasSpeeds } from '../../services/bundlers/types'
import { AbstractPaymaster } from '../paymaster/abstractPaymaster'
import { TokenResult } from '../portfolio'

export interface BundlerEstimateResult {
  preVerificationGas: Hex
  verificationGasLimit: Hex
  callGasLimit: Hex
  paymasterVerificationGasLimit?: Hex
  paymasterPostOpGasLimit?: Hex
}

export interface BundlerStateOverride {
  [accAddr: string]: {
    code: string
    stateDiff?: {
      [key: string]: string
    }
  }
}

export interface EstimationFlags {
  hasNonceDiscrepancy?: boolean
  has4337NonceDiscrepancy?: boolean
}

export interface Erc4337GasLimits {
  // this is basically gasUsed
  callGasLimit: string
  preVerificationGas: string
  verificationGasLimit: string
  paymasterVerificationGasLimit: string
  paymasterPostOpGasLimit: string
  gasPrice: GasSpeeds
  paymaster: AbstractPaymaster
  flags: EstimationFlags
  feeCallType?: string
  // put here errors that are not fatal to the signing process
  // but reactable if known
  // example: bundler simulation fails because of incorrect 4337 nonce.
  // The user can still broadcast with EOA but we can also react
  // to this error by setting the correct nonce and re-estimating
  nonFatalErrors?: Error[]
}

export interface FeePaymentOption {
  availableAmount: bigint
  paidBy: string
  gasUsed: bigint
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
  // put here errors that are not fatal to the signing process
  // but reactable if known
  // example: bundler simulation fails because of incorrect 4337 nonce.
  // The user can still broadcast with EOA but we can also react
  // to this error by setting the correct nonce and re-estimating
  nonFatalErrors?: Error[]
}

export interface ProviderEstimation {
  gasUsed: bigint
  feePaymentOptions: FeePaymentOption[]
}

export interface AmbireEstimation {
  gasUsed: bigint
  deploymentGas: bigint
  feePaymentOptions: FeePaymentOption[]
  ambireAccountNonce: number
  flags: EstimationFlags
}

export interface PerCallEstimation {
  gasUsed: bigint
  gasUsedPerCall: bigint[]
}

// Null means that the estimation was not done (e.g. it's irrelevant to the account type)
export interface FullEstimation {
  provider: ProviderEstimation | Error | null
  ambire: AmbireEstimation | Error // Ambire estimation is used always
  bundler: Erc4337GasLimits | Error | null
  // flags that signal to the app what needs to be handled if a state
  // inconsistency issue was found during estimation
  flags: EstimationFlags
}

export interface FullEstimationSummary {
  providerEstimation?: ProviderEstimation
  ambireEstimation?: AmbireEstimation
  bundlerEstimation?: Erc4337GasLimits
  flags: EstimationFlags
}
