import { Network } from '../../interfaces/network'
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

export interface PositionAsset {
  address: string
  symbol: string
  decimals: number
  amount: bigint
  priceIn: Price[]
  value?: number
  type: AssetType
  additionalData?: {
    [key: string]: any
  }
}

export interface DeFiPositionsState {
  [accountId: string]: AccountState
}

export interface AccountState {
  [networkId: string]: NetworkState
}

export interface ProviderError {
  providerName: string
  error: string
}

export interface NetworkState {
  positionsByProvider: PositionsByProvider[]
  isLoading: boolean
  updatedAt?: number
  error?: string | null
  providerErrors?: ProviderError[]
}

export interface PositionsByProvider {
  providerName: string
  networkId: Network['id']
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
