import { Network } from '../../interfaces/network'
import { Price } from '../portfolio'

export enum AssetType {
  Liquidity,
  Collateral,
  Borrow
}

export interface PositionAsset {
  address: string
  symbol: string
  decimals: number
  amount: bigint
  priceIn: Price[]
  type: AssetType
  additionalData: any | undefined
}

export interface Position {
  providerName: string
  positionType: string
  assets: PositionAsset[]
  networkId: Network['id']
  additionalData: {
    positionId: string
    [key: string]: any
  }
}
