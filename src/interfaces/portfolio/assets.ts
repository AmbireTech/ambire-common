export interface Price {
  baseCurrency: string
  price: number
}

export type PendingAmounts = {
  isPending: boolean
  pendingBalance: bigint
  pendingToBeSigned?: bigint
  pendingToBeConfirmed?: bigint
}

export type FormattedPendingAmounts = Omit<PendingAmounts, 'pendingBalance'> & {
  pendingBalance: string
  pendingBalanceFormatted: string
  pendingBalanceUSDFormatted?: string
  pendingToBeSignedFormatted?: string
  pendingToBeConfirmedFormatted?: string
}

export type SuspectedType = 'suspected' | null

export type TokenResult = {
  symbol: string
  name: string
  decimals: number
  address: string
  chainId: bigint
  amount: bigint
  latestAmount?: bigint
  pendingAmount?: bigint
  simulationAmount?: bigint
  amountPostSimulation?: bigint
  priceIn: Price[]
  flags: {
    onGasTank: boolean
    rewardsType: 'wallet-vesting' | 'wallet-rewards' | 'wallet-projected-rewards' | null
    defiTokenType?: DefiAssetType
    /**
     * A property used to link a token to a specific defi position. It's used
     * to prevent double counting of balances in the portfolio total.
     * As collateral tokens are part of the defi positions, but also held
     * as regular tokens in the portfolio, we use this property to identify
     * which token is used as collateral in which position.
     */
    defiPositionId?: string
    canTopUpGasTank: boolean
    isFeeToken: boolean
    isHidden?: boolean
    isCustom?: boolean
    suspectedType?: SuspectedType
  }
}

export type GasTankTokenResult = TokenResult & {
  availableAmount: bigint
}

export interface CollectionResult extends TokenResult {
  name: string
  collectibles: bigint[]
  postSimulation?: {
    sending?: bigint[]
    receiving?: bigint[]
  }
}

export enum DefiAssetType {
  Liquidity,
  Collateral,
  Borrow,
  Reward
}

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
  type: DefiAssetType
  additionalData?: {
    [key: string]: any
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
