import { Route as LiFiRoute, Token as LiFiToken } from '@lifi/types'

import { AccountOpIdentifiedBy } from '../libs/accountOp/submittedAccountOp'
import { TokenResult } from '../libs/portfolio'
import { ControllerInterface } from './controller'

export type ISwapAndBridgeController = ControllerInterface<
  InstanceType<typeof import('../controllers/swapAndBridge/swapAndBridge').SwapAndBridgeController>
>

export interface SocketAPIResponse<T> {
  result: T
  success?: boolean
  message?: { error?: string; details?: any }
}

export interface SocketAPIToken {
  address: string
  chainId: number
  decimals: number
  icon: string
  logoURI: string
  name: string
  symbol: string
}

export interface SwapAndBridgeToToken {
  symbol: string
  name: string
  chainId: number
  address: string
  icon?: string
  decimals: number
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

export interface SwapAndBridgeQuote {
  fromAsset: SwapAndBridgeToToken
  fromChainId: number
  toAsset: SwapAndBridgeToToken
  toChainId: number
  selectedRoute?: SwapAndBridgeRoute
  selectedRouteSteps: SwapAndBridgeStep[]
  routes: SwapAndBridgeRoute[]
}

export interface SocketAPIRoute {
  routeId: string
  isOnlySwapRoute: boolean
  fromAmount: string
  toAmount: string
  usedBridgeNames?: string[]
  usedDexName?: string
  totalUserTx: number
  recipient: string
  sender: string
  userTxs: SocketAPIUserTx[]
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

interface BungeeApprovalData {
  amount: string
  tokenAddress: string
  spenderAddress: string
  userAddress: string
}

export interface SwapAndBridgeRoute {
  providerId: string
  routeId: string
  currentUserTxIndex: number
  fromChainId: number
  toChainId: number
  userAddress: string
  isOnlySwapRoute: boolean
  fromAmount: string
  toAmount: string
  usedBridgeNames?: string[]
  usedDexName?: string
  // TODO: Deprecate userTxs
  userTxs: SwapAndBridgeUserTx[]
  sender?: string
  steps: SwapAndBridgeStep[]
  inputValueInUsd: number
  outputValueInUsd: number
  serviceTime: number
  rawRoute: SocketAPIRoute | LiFiRoute
  toToken: LiFiToken
  disabled: boolean
  disabledReason?: string
  isSelectedManually?: boolean
  // applied only for bridges
  // some bridges require a fee paid out in source chain native that we cannot
  // abstract. That's why we put it here and display it to the user so he
  // knows extra fee is going to leave his account
  serviceFee?: {
    amount: string
    amountUSD: string
  }
  // the socket auto route comes with approvalData & txData
  approvalData?: BungeeApprovalData
  txData?: BungeeTxData
  /**
   * We don't charge a convenience fee for some operations.
   * Also, on some chains we have a fee with some providers while
   * we don't have with others.
   * @example - Wrapping and unwrapping natives
   */
  withConvenienceFee: boolean
  isIntent?: boolean // we add this by ourselves
}

export interface SocketAPISwapUserTx {
  userTxIndex: number
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
  approvalData: SocketAPIUserTxApprovalData | null
}

export interface SocketAPIBridgeUserTx {
  userTxIndex: number
  toAsset: SocketAPIToken
  toAmount: string
  steps: SocketAPIStep[]
  stepCount: number
  serviceTime: number
  routePath: string
  maxServiceTime: number
  chainId: number
  bridgeSlippage: number
  approvalData: SocketAPIUserTxApprovalData | null
}

export interface SocketApiSwapStep {
  chainId: number
  fromAmount: string
  fromAsset: SocketAPIToken
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
  minAmountOut: string
  protocol: {
    name: string
    displayName: string
    icon: string
  }
  protocolFees: {
    amount: string
    asset: SocketAPIToken
    feesInUsd: number
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

export type SwapAndBridgeStep = {
  chainId?: number
  fromAmount: string
  fromAsset: SwapAndBridgeToToken
  serviceTime?: number
  minAmountOut: string
  protocol: {
    name: string
    displayName: string
    icon: string
  }
  protocolFees?: {
    amount: string
    asset: SwapAndBridgeToToken
    feesInUsd: number
  }
  swapSlippage?: number
  toAmount: string
  toAsset: SwapAndBridgeToToken
  type: 'middleware' | 'swap'
  userTxIndex: number
}

export type SocketAPIUserTx = SocketAPISwapUserTx | SocketAPIBridgeUserTx

export type SwapAndBridgeUserTx = {
  userTxIndex: number
  fromAsset: SwapAndBridgeToToken
  toAsset: SwapAndBridgeToToken
  chainId: number
  fromAmount: string
  toAmount: string
  swapSlippage?: number
  serviceTime?: number
  protocol: {
    displayName: string
    icon: string
    name: string
  }
  minAmountOut: string
}

export type SocketAPIUserTxApprovalData = {
  allowanceTarget: string
  approvalTokenAddress: string
  minimumApprovalAmount: string
  owner: string
}

export type SwapAndBridgeApproval = {
  allowanceTarget: string
  approvalTokenAddress: string
  minimumApprovalAmount: string
}

export type SwapAndBridgeTxApprovalData = {
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
  userTxIndex: number
  value: string
  serviceFee: {
    included: boolean
    amount: string
    amountUSD: string
    description: string
    name: string
  }[]
}

export type SwapAndBridgeSendTxRequest = {
  activeRouteId: string
  approvalData: SwapAndBridgeTxApprovalData | null
  chainId: number
  txData: string
  txTarget: string
  userTxIndex: number
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

export type SwapAndBridgeActiveRoute = {
  serviceProviderId: string
  // FIXME: Temporarily set `fromAsset` and `toAsset` also as maybe missing,
  // they could have indeed be missing for old active routes in storage.
  fromAsset?: SocketAPIToken
  toAsset?: SocketAPIToken
  fromAssetAddress: string
  toAssetAddress: string
  steps: SwapAndBridgeStep[]
  sender: string
  activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId']
  userTxIndex: SwapAndBridgeSendTxRequest['userTxIndex']
  userTxHash: string | null
  identifiedBy: AccountOpIdentifiedBy | null
  route?: SwapAndBridgeRoute & {
    routeStatus: string
    fromChainId: number
    toChainId: number
    currentUserTxIndex: number
    transactionData: { txHash: string }[] | null
    userAddress: string
  }
  routeStatus:
    | 'waiting-approval-to-resolve'
    | 'in-progress'
    | 'ready'
    | 'completed'
    | 'failed'
    | 'refunded'
  error?: string
}

export type SocketAPIActiveRoutes = ActiveRoute['route'] & {
  activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
  userAddress: string
  userTxs: SocketAPIUserTx[]
  fromAssetAddress: string
  toAssetAddress: string
  fromAmount: string
  toAmount: string
  fromAsset: SocketAPIToken
  toAsset: SocketAPIToken
}

export interface BungeeRouteStatus {
  hash: string
  bungeeStatusCode: number
}

export type SwapAndBridgeRouteStatus = 'ready' | 'completed' | 'refunded' | null

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

export type CachedSupportedChains = { lastFetched: number; data: SwapAndBridgeSupportedChain[] }

export interface SwapAndBridgeSupportedChain {
  chainId: number
}

type StringifiedChainId = string
export type CachedTokenListKey = `from-${StringifiedChainId}-to-${StringifiedChainId}`
export type CachedToTokenLists = {
  [key: CachedTokenListKey]: { lastFetched: number; data: SwapAndBridgeToToken[] }
}

export type FromToken = TokenResult & {
  isSwitchedToToken?: boolean
}

interface BungeeExchangeOutput {
  amount: string
  effectiveReceivedInUsd: number
  minAmountOut: string
  priceInUsd: number
  token: SocketAPIToken
  valueInUsd: number
}

interface BungeeTxData {
  data: string
  to: string
  value: string
  chainId: number
}

interface BungeeRouteDetails {
  dexDetails: string | null
  logoURI: string
  name: string
  routeFee: {
    amount: string
    feeInUsd: number
    priceInUsd: number
    token: SocketAPIToken
  } | null
}

export interface BungeeExchangeQuoteResponse {
  autoRoute: {
    output: BungeeExchangeOutput
    quoteId: string
    quoteExpiry: number
    estimatedTime?: number
    routeDetails: BungeeRouteDetails
    slippage: number

    requestHash: string
    requestType: string
    affiliateFee: {} | null
    suggestedClientSlippage: number
    approvalData: BungeeApprovalData
    txData: BungeeTxData
    isIntent?: boolean // we add this by ourselves
  }
  destinationChainId: number
  input: {
    token: SocketAPIToken
    priceInUsd: number
    amount: string
    valueInUsd: number
  }
  manualRoutes: {
    output: BungeeExchangeOutput
    quoteId: string
    quoteExpiry: number
    estimatedTime?: number
    routeDetails: BungeeRouteDetails
    slippage: number
    isIntent?: boolean // we add this by ourselves
  }[]
  originChainId: number
  receiverAddress: string
  userAddress: string
}

export interface BungeeBuildTxnResponse {
  userOp: string
  approvalData: BungeeApprovalData | null
  txData: BungeeTxData
}

export interface ProviderQuoteParams {
  fromAsset: TokenResult | null
  fromChainId: number
  fromTokenAddress: string
  toAsset: SwapAndBridgeToToken | null
  toChainId: number
  toTokenAddress: string
  fromAmount: bigint
  userAddress: string
  sort: 'time' | 'output'
  isWrapOrUnwrap: boolean
  accountNativeBalance: bigint
  nativeSymbol: string
}

export interface SwapProvider {
  id: string
  name: string
  isHealthy: boolean | null
  updateHealth(): void
  resetHealth(): void
  /**
   * List of supported chains by the provider
   * null if a successful fetch has not been made yet
   */
  supportedChains: SwapAndBridgeSupportedChain[] | null
  getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]>
  getToTokenList({
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SwapAndBridgeToToken[]>
  getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null>
  startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest>
  quote({
    fromAsset,
    fromChainId,
    fromTokenAddress,
    toAsset,
    toChainId,
    toTokenAddress,
    fromAmount,
    userAddress,
    sort,
    accountNativeBalance,
    nativeSymbol
  }: ProviderQuoteParams): Promise<SwapAndBridgeQuote>
  getRouteStatus({
    txHash,
    fromChainId,
    toChainId,
    bridge,
    providerId
  }: {
    txHash: string
    fromChainId: number
    toChainId: number
    bridge?: string
    providerId: string
  }): Promise<SwapAndBridgeRouteStatus>
}
