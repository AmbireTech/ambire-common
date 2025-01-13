import { Hex } from '../../interfaces/hex'
import { GasSpeeds } from '../../services/bundlers/types'
import { AbstractPaymaster } from '../paymaster/abstractPaymaster'
import { TokenResult } from '../portfolio'

export interface BundlerEstimateResult {
  preVerificationGas: Hex
  verificationGasLimit: Hex
  callGasLimit: Hex
  paymasterVerificationGasLimit: Hex
  paymasterPostOpGasLimit: Hex
}

export interface Erc4337GasLimits {
  preVerificationGas: string
  verificationGasLimit: string
  callGasLimit: string
  paymasterVerificationGasLimit: string
  paymasterPostOpGasLimit: string
  gasPrice: GasSpeeds
  paymaster: AbstractPaymaster
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
  // put here errors that are not fatal to the signing process
  // but reactable if known
  // example: bundler simulation fails because of incorrect 4337 nonce.
  // The user can still broadcast with EOA but we can also react
  // to this error by setting the correct nonce and re-estimating
  nonFatalErrors?: Error[]
}
