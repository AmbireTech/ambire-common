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
  fromAsset: SocketAPIToken
  fromChainId: number
  toAsset: SocketAPIToken
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
    userTxs: (SocketAPIBridgeUserTx | SocketAPISwapUserTx)[]
    receivedValueInUsd: number
    inputValueInUsd: number
    outputValueInUsd: number
    serviceTime: number
    maxServiceTime: number
    integratorFee: {
      feeTakerAddress: string
      amount: string
      asset: SocketAPIToken
    }
    chainGasBalances: object
    minimumGasBalances: object
    extraData: object
  }
}

export interface SocketAPISwapUserTx {
  userTxType: 'dex-swap'
  userTxIndex: number
  txType: string
  fromAsset: SocketAPIToken
  toAsset: SocketAPIToken
  chainId: number
  fromAmount: string
  toAmount: string
  swapSlippage: number
  sender: string
  recipient: string
  protocol: {
    displayName: string
    icon: string
    name: string
  }
  minAmountOut: string
  gasFees: {
    gasAmount: string
    gasLimit: number
    feesInUsd: number
    asset: SocketAPIToken
  }
  approvalData: unknown
}

export interface SocketAPIBridgeUserTx {
  userTxType: 'fund-movr'
  userTxIndex: number
  txType: string
  toAsset: SocketAPIToken
  toAmount: string
  steps: any[]
  stepCount: number
  serviceTime: number
  sender: string
  routePath: string
  recipient: string
  maxServiceTime: number
  gasFees: {
    gasAmount: string
    gasLimit: number
    feesInUsd: number
    asset: SocketAPIToken
  }
  chainId: number
  bridgeSlippage: number
  approvalData: unknown
}
