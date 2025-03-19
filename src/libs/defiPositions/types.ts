import { Price } from '../portfolio'

export enum AssetType {
  Liquidity,
  Collateral,
  Borrow
}

export enum DeFiPositionsError {
  AssetPriceError = 'AssetPriceError',
  CriticalError = 'CriticalError'
}

export type ProviderName = 'AAVE v3' | 'Uniswap V3'

export interface PositionAsset {
  address: string
  symbol: string
  name: string
  decimals: number
  amount: bigint
  simulationAmount?: bigint
  amountPostSimulation?: bigint
  priceIn: Price[]
  value?: number
  type: AssetType
  additionalData?: {
    [key: string]: any
  }
  protocolAsset?: {
    address: string
    symbol: string
    name: string
    decimals: number
  }
}

export interface DeFiPositionsState {
  [accountId: string]: AccountState
}

export interface AccountState {
  [chainId: string]: NetworkState
}

export interface ProviderError {
  providerName: ProviderName
  error: string
}

export interface NetworkState {
  positionsByProvider: PositionsByProvider[]
  isLoading: boolean
  updatedAt?: number
  error?: string | null
  providerErrors?: ProviderError[]
}

export type NetworksWithPositions = {
  [chainId: string]: ProviderName[]
}

export type NetworksWithPositionsByAccounts = {
  [accountId: string]: NetworksWithPositions
}

export type PositionsByProvider = {
  providerName: ProviderName
  chainId: bigint
  type: 'lending' | 'liquidity-pool'
  positions: Position[]
  positionInUSD?: number
}

export interface Position {
  id: string
  assets: PositionAsset[]
  additionalData: {
    [key: string]: any
  }
}
