import { ProviderName } from './defiLib'

export type TokenError = string | '0x'
export interface ExtendedError extends Error {
  simulationErrorMsg?: string
}

export type ExtendedErrorWithLevel = ExtendedError & {
  level: 'critical' | 'warning' | 'silent'
}

export enum DeFiPositionsError {
  AssetPriceError = 'AssetPriceError',
  CriticalError = 'CriticalError'
}

export interface ProviderError {
  providerName: ProviderName
  error: string
}
