export enum AssetType {
  Liquidity,
  Collateral,
  Borrow
}

export interface PositionAsset {
  symbol: string
  decimals: number
  amount: number
  type: AssetType
  additionalData: any | undefined
}

export interface Position {
  providerName: string
  positionType: string
  assets: PositionAsset[]
  network: string
  additionalData: {
    positionId: string
    [key: string]: any
  }
}
