import { PositionAsset } from './assets'

export type ProviderName = 'AAVE v3' | 'Uniswap V3' | 'Ambire' | string

export type PositionsByProvider = {
  providerName: ProviderName
  chainId: bigint
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
  positionInUSD?: number
}

export interface Position {
  id: string
  assets: PositionAsset[]
  additionalData: {
    [key: string]: any
  }
}
