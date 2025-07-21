import { Price } from '../../interfaces/assets'

export enum AssetType {
  Liquidity,
  Collateral,
  Borrow,
  Reward
}

export enum DeFiPositionsError {
  AssetPriceError = 'AssetPriceError',
  CriticalError = 'CriticalError'
}

export type ProviderName = 'AAVE v3' | 'Uniswap V3' | 'Ambire' | string

export interface PositionAsset {
  address: string
  symbol: string
  name: string
  decimals: number
  amount: bigint
  iconUrl: string
  simulationAmount?: bigint
  amountPostSimulation?: bigint
  priceIn: Price
  value?: number
  type: AssetType
  additionalData?: {
    [key: string]: any
  }
  /**
   * The protocol asset is the protocol's representation of the asset.
   * For example, in Aave, the protocol asset is the aToken.
   */
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
  nonceId?: string
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
  iconUrl: string
  siteUrl: string
  type:
    | 'common'
    | 'locked'
    | 'lending'
    | 'leveraged_farming'
    | 'vesting'
    | 'reward'
    | 'options_seller'
    | 'options_buyer'
    | 'insurance_seller'
    | 'insurance_buyer'
    | 'perpetuals'
    | 'nft_common'
    | 'nft_lending'
    | 'nft_fraction'
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
