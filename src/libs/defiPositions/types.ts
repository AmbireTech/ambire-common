import { Price } from '../../interfaces/assets'

// @TODO: Move these interfaces to src/interfaces and
// figure out how to restructure portfolio/defiPositions types

export enum AssetType {
  Liquidity,
  Collateral,
  Borrow,
  Reward,
  Margin,
  Perpetual,
  Prediction
}

export enum DeFiPositionsError {
  AssetPriceError = 'AssetPriceError',
  CriticalError = 'CriticalError'
}

export type ProviderName = 'AAVE v3' | 'Uniswap V3' | 'Ambire' | string

export interface PositionAsset {
  /**
   * Undefined for assets of App positions (polymarket, hyperliquid, etc.) since they don't have an on-chain representation.
   */
  address?: string
  symbol: string
  name: string
  decimals: number
  amount: bigint
  iconUrl: string
  simulationAmount?: bigint
  amountPostSimulation?: bigint
  priceIn?: Price
  value?: number
  type: AssetType
  additionalData?: {
    [key: string]: any
  }
  /**
   * The amount of the asset converted to another token by the protocol's own price (e.g. the
   * collateral of a Morpho market, converted to the loan token by the market's oracle).
   * Used to value the asset when it has no price of its own.
   */
  priceFallback?: {
    address: string
    decimals: number
    amount: bigint
  }
  /**
   * The protocol asset is the protocol's representation of the asset.
   * For example, in Aave, the protocol asset is the aToken.
   */
  protocolAsset?:
    | {
        address: string
        symbol: string
        name: string
        decimals: number
      }
    | {
        address: string
      }
}

export interface ProviderError {
  providerName: ProviderName
  error: string
}

/**
 * The positions each protocol returned when read from the chain, before they were merged with
 * the API positions and priced, so a later update can merge them with newer API positions
 */
export type RpcDefiRead = {
  /** The positions of each protocol read, by its name. Null if the account had none */
  positionsByProviderName: { [providerName: string]: PositionsByProvider | null }
  readAt: number
}

export interface NetworkState {
  positionsByProvider: PositionsByProvider[]
  /**
   * Timestamp of the last successful update
   * (no custom provider errors and a successful external api call)
   *
   * Used to determine whether to update the positions and display
   * errors on the UI
   */
  lastSuccessfulUpdate?: number
  /**
   * The last read of the positions from the chain without errors. Missing if the last read
   * failed.
   *
   * Reused instead of reading the positions on every portfolio update (see
   * `getReusableRpcDefiRead`)
   */
  rpcRead?: RpcDefiRead
  /**
   * Timestamp of the last force external api call
   * Used to determine if we should bypass the cache on next update
   */
  lastForceApiUpdate?: number
  error?: string | null
  providerErrors?: ProviderError[]
  nonceId?: string
}

export type NetworksWithPositions = {
  [chainId: string]: ProviderName[]
}

/**
 * The count of defi positions on disabled networks for each account.
 */
export type PositionCountOnDisabledNetworks = {
  [accountId: string]: {
    [chainId: string]: number
  }
}

export type NetworksWithPositionsByAccounts = {
  [accountId: string]: NetworksWithPositions
}

export type PositionsByProvider = {
  providerName: ProviderName
  /**
   * Undefined for App positions (polymarket, hyperliquid, etc.) since they don't have an on-chain representation.
   */
  chainId?: bigint
  iconUrl: string
  siteUrl: string
  source: 'debank' | 'custom' | 'mixed'
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
  /** The value of all positions, with their loans subtracted. */
  positionInUSD?: number
  /** The value of all positions without their loans subtracted. */
  collateralInUSD?: number
}

/** The values of a DeFi app or position, with and without its loans subtracted. */
export type DefiValues = Pick<PositionsByProvider, 'positionInUSD' | 'collateralInUSD'>

export interface Position {
  id: string
  assets: PositionAsset[]
  additionalData: {
    positionIndex?: string
    name?: string
    APY?: number
    /** The value of the position, with its loans subtracted. */
    positionInUSD?: number
    /** The value of the position without its loans subtracted. */
    collateralInUSD?: number
    debtInUSD?: number
    healthRate?: number | null
    description?: string
    [key: string]: any
  }
}
