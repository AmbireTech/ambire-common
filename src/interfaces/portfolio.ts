export interface RelayerReponsePortfolioAdditional {
  rewards?: {
    supplyControllerAddr: string
    claimableRewardsData: {
      addr: string
      fromBalanceClaimable: number
      fromADXClaimable: number
      totalClaimable: string
      leaf?: string
      proof?: string[]
      root?: string
      signedRoot?: string
    }
    multipliers?: { mul: number; name: string }[]
    xWalletClaimableBalance: {
      address: string
      symbol: string
      amount: string
      decimals: number
      networkId: string
      priceIn?: {
        baseCurrency: string
        price: number
      }[]
    }
  }
  gasTank?: {
    balance?: {
      address: string
      symbol: string
      amount: string
      decimals: number
      networkId: string
      priceIn: {
        baseCurrency: string
        price: number
      }[]
    }[]

    availableGasTankAssets: {
      address: string
      symbol: string
      network: string
      decimals: number
      icon: string
      price: number
    }[]
  }
}
