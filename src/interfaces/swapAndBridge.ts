export interface SocketAPIToken {
  address: string
  chainId: number
  decimals: number
  icon: string
  logoURI: string
  name: string
  symbol: string
}

export interface SocketAPIQuote {
  fromAsset: {
    address: string
    chainId: number
    decimals: number
    icon: string
    name: string
    symbol: string
  }
  fromChainId: number
  toAsset: {
    address: string
    chainId: number
    decimals: number
    icon: string
    name: string
    symbol: string
  }
  toChainId: number
  route: {
    routeId: string
    isOnlySwapRoute: boolean
    fromAmount: string
    toAmount: string
    usedBridgeNames: string[]
    totalUserTx: number
    totalGasFeesInUsd: number
    recipient: string
    sender: string
    userTxs: object[]
    receivedValueInUsd: number
    inputValueInUsd: number
    outputValueInUsd: number
    serviceTime: number
    maxServiceTime: number
    integratorFee: {
      feeTakerAddress: string
      amount: string
      asset: {
        name: string
        address: string
        icon: string
        decimals: number
        symbol: string
        chainId: string
      }
    }
    chainGasBalances: object
    minimumGasBalances: object
    extraData: object
  }
}
