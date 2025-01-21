export interface SocketAPIToken {
  address: string
  chainId: number
  decimals: number
  icon: string
  logoURI: string
  name: string
  symbol: string
}

export interface SwapAndBridgeToToken extends SocketAPIToken {
  // TODO: Strip out the properties that are not needed.
}

export interface SocketAPIQuote {
  fromAsset: SocketAPIToken
  fromChainId: number
  toAsset: SocketAPIToken
  toChainId: number
  selectedRoute: SocketAPIRoute
  selectedRouteSteps: SocketAPIStep[]
  routes: SocketAPIRoute[]
}

export interface SocketAPIRoute {
  routeId: string
  isOnlySwapRoute: boolean
  fromAmount: string
  toAmount: string
  usedBridgeNames?: string[]
  usedDexName?: string
  totalUserTx: number
  totalGasFeesInUsd: number
  recipient: string
  sender: string
  userTxs: SocketAPIUserTx[]
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
  errorMessage?: string
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
  approvalData: SocketAPIUserTxApprovalData | null
}

export interface SocketAPIBridgeUserTx {
  userTxType: 'fund-movr'
  userTxIndex: number
  txType: string
  toAsset: SocketAPIToken
  toAmount: string
  steps: SocketAPIStep[]
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
  approvalData: SocketAPIUserTxApprovalData | null
}

export interface SocketApiSwapStep {
  chainId: number
  fromAmount: string
  fromAsset: SocketAPIToken
  gasFees: {
    gasAmount: string
    gasLimit: number
    feesInUsd: number
    asset: SocketAPIToken
  }
  minAmountOut: string
  protocol: {
    name: string
    displayName: string
    icon: string
  }
  swapSlippage: number
  toAmount: string
  toAsset: SocketAPIToken
  type: 'middleware' | 'swap'
  userTxIndex?: number
}

export interface SocketApiBridgeStep {
  fromChainId: number
  toChainId: number
  fromAmount: string
  fromAsset: SocketAPIToken
  gasFees: {
    gasAmount: string
    gasLimit: number
    feesInUsd: number
    asset: SocketAPIToken
  }
  minAmountOut: string
  protocol: {
    name: string
    displayName: string
    icon: string
  }
  protocolFees: {
    amount: string
    asset: SocketAPIToken
  }
  bridgeSlippage: number
  toAmount: string
  toAsset: SocketAPIToken
  serviceTime: number
  maxServiceTime: number
  type: 'bridge'
  userTxIndex?: number
}

export type SocketAPIStep = SocketApiSwapStep | SocketApiBridgeStep

export type SocketAPIUserTx = SocketAPISwapUserTx | SocketAPIBridgeUserTx

export type SocketAPIUserTxApprovalData = {
  allowanceTarget: string
  approvalTokenAddress: string
  minimumApprovalAmount: string
  owner: string
}

export type SocketAPISendTransactionRequest = {
  activeRouteId: number
  approvalData: SocketAPIUserTxApprovalData | null
  chainId: number
  totalUserTx: number
  txData: string
  txTarget: string
  txType: 'eth_sendTransaction'
  userTxIndex: number
  userTxType: 'fund-movr' | 'dex-swap'
  value: string
}

export type ActiveRoute = {
  activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
  userTxIndex: SocketAPISendTransactionRequest['userTxIndex']
  userTxHash: string | null
  route: Omit<SocketAPIQuote['selectedRoute'], 'serviceTime' | 'maxServiceTime'> & {
    createdAt: string
    updatedAt: string
    routeStatus: string
    fromChainId: number
    toChainId: number
    currentUserTxIndex: number
    transactionData: { txHash: string }[] | null
    userAddress: string
  }
  routeStatus: 'waiting-approval-to-resolve' | 'in-progress' | 'ready' | 'completed' | 'failed'
  error?: string
}

export type SocketAPIActiveRoutes = ActiveRoute['route'] & {
  activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
  userAddress: string
  totalUserTx: number
  userTxs: SocketAPIUserTx[]
  fromAssetAddress: string
  toAssetAddress: string
  fromAmount: string
  toAmount: string
  fromAsset: SocketAPIToken
  toAsset: SocketAPIToken
}

export type SocketAPISupportedChain = {
  chainId: number
  name: string
  isL1: boolean
  sendingEnabled: boolean
  icon: string
  receivingEnabled: boolean
  refuel: {
    sendingEnabled: boolean
    receivingEnabled: boolean
  }
  currency: {
    address: SocketAPIToken['address']
    icon: SocketAPIToken['icon']
    name: SocketAPIToken['name']
    symbol: SocketAPIToken['symbol']
    decimals: SocketAPIToken['decimals']
    minNativeCurrencyForGas: string
  }
  rpcs: string[]
  explorers: string[]
}

export type CachedSupportedChains = { lastFetched: number; data: SocketAPISupportedChain[] }

type StringifiedChainId = string
export type CachedTokenListKey = `from-${StringifiedChainId}-to-${StringifiedChainId}`
export type CachedToTokenLists = {
  [key: CachedTokenListKey]: { lastFetched: number; data: SocketAPIToken[] }
}
