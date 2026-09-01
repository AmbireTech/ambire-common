import {
  formatUnits,
  getAddress,
  Interface,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
  TypedDataEncoder,
  ZeroAddress
} from 'ethers'

import { FEE_COLLECTOR } from '@/consts/addresses'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { getTokenUsdAmount } from '../../controllers/signAccountOp/helper'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  CowSwapOrderCreation,
  CowSwapQuoteResponse,
  CowSwapRawRoute,
  ProviderQuoteParams,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatusResult,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeStep,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapAndBridgeUserTx,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import {
  convertPortfolioTokenToSwapAndBridgeToToken,
  getSlippage,
  isNoFeeToken
} from '../../libs/swapAndBridge/swapAndBridge'
import { FEE_PERCENT } from '../socketv3/constants'
import {
  COWSWAP_API_BASE_URL,
  COWSWAP_APP_CODE,
  COWSWAP_APP_DATA_VERSION,
  COWSWAP_BUY_NATIVE_TOKEN_ADDRESS,
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_ORDER_VALIDITY_SECONDS,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_SUPPORTED_CHAINS,
  COWSWAP_VAULT_RELAYER_ADDRESS
} from './constants'

const settlementInterface = new Interface(['function setPreSignature(bytes orderUid, bool signed)'])
const ethFlowInterface = new Interface([
  'function createOrder((address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,bool partiallyFillable,int64 quoteId) order) payable returns (bytes32 orderHash)'
])

const AMBIRE_FEE_BPS = Math.round(FEE_PERCENT * 100)
const MAX_VALID_TO = 2 ** 32 - 1

const orderTypes = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'sellTokenBalance', type: 'string' },
    { name: 'buyTokenBalance', type: 'string' }
  ]
}

type CowSwapOrderStatus = 'presignaturePending' | 'open' | 'fulfilled' | 'cancelled' | 'expired'

type CowSwapOrderResponse = {
  status: CowSwapOrderStatus
}

type CowSwapTrade = {
  txHash?: string | null
}

type CowSwapErrorResponse = {
  errorType?: string
  description?: string
  message?: string
}

const getApiNetwork = (chainId: number) =>
  COWSWAP_SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId)?.apiNetwork

const getWrappedNativeTokenAddress = (chainId: number) =>
  COWSWAP_SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId)?.wrappedNativeTokenAddress

const normalizeBuyTokenAddress = (address: string) =>
  address.toLowerCase() === ZeroAddress.toLowerCase()
    ? COWSWAP_BUY_NATIVE_TOKEN_ADDRESS
    : getAddress(address)

const getProtocolFeeAmount = (buyAmount: bigint, protocolFeeBps: number) => {
  if (protocolFeeBps <= 0) return 0n

  const precision = 100000n
  const protocolFeeBpsWithPrecision = BigInt(Math.round(protocolFeeBps * Number(precision)))
  const denominator = 10000n * precision - protocolFeeBpsWithPrecision

  if (denominator <= 0n) {
    throw new SwapAndBridgeProviderApiError(
      'Unable to fetch the quote. CoW Swap returned an invalid fee.'
    )
  }

  return (buyAmount * protocolFeeBpsWithPrecision) / denominator
}

const buildAppData = ({
  slippageBps,
  withConvenienceFee
}: {
  slippageBps: number
  withConvenienceFee: boolean
}) => {
  const appData = {
    appCode: COWSWAP_APP_CODE,
    metadata: {
      orderClass: { orderClass: 'market' },
      ...(withConvenienceFee
        ? {
            partnerFee: {
              recipient: FEE_COLLECTOR,
              volumeBps: AMBIRE_FEE_BPS
            }
          }
        : {}),
      quote: { slippageBips: slippageBps }
    },
    version: COWSWAP_APP_DATA_VERSION
  }
  const fullAppData = JSON.stringify(appData)

  return {
    fullAppData,
    appDataHash: keccak256(toUtf8Bytes(fullAppData))
  }
}

const computeOrderUid = ({
  chainId,
  order,
  owner,
  isEthFlow
}: {
  chainId: number
  order: CowSwapOrderCreation
  owner: string
  isEthFlow: boolean
}) => {
  const validTo = isEthFlow ? MAX_VALID_TO : order.validTo
  const orderDigest = TypedDataEncoder.hash(
    {
      name: 'Gnosis Protocol',
      version: 'v2',
      chainId,
      verifyingContract: COWSWAP_SETTLEMENT_ADDRESS
    },
    orderTypes,
    {
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      receiver: order.receiver,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      validTo,
      appData: order.appDataHash,
      feeAmount: order.feeAmount,
      kind: order.kind,
      partiallyFillable: order.partiallyFillable,
      sellTokenBalance: order.sellTokenBalance,
      buyTokenBalance: order.buyTokenBalance
    }
  )

  return solidityPacked(
    ['bytes32', 'address', 'uint32'],
    [orderDigest, isEthFlow ? COWSWAP_ETH_FLOW_ADDRESS : owner, validTo]
  )
}

const getOutputValueInUsd = ({
  inputValueInUsd,
  toAsset,
  toAmount,
  buyAmountBeforeFees
}: {
  inputValueInUsd: number
  toAsset: SwapAndBridgeToToken
  toAmount: string
  buyAmountBeforeFees: bigint
}) => {
  const priceUSD = Number(toAsset.priceUSD || 0)
  if (!priceUSD) {
    return inputValueInUsd * (Number(toAmount) / Number(buyAmountBeforeFees))
  }

  return Number(formatUnits(toAmount, toAsset.decimals)) * priceUSD
}

export class CowSwapAPI implements SwapProvider {
  id = 'cowswap'

  name = 'CoW Swap'

  #fetch: Fetch

  #headers: RequestInitWithCustomHeaders['headers'] = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  #requestTimeoutMs = 15000

  isHealthy: boolean | null = null

  supportedChains: SwapProvider['supportedChains'] = null

  constructor({ fetch }: { fetch: Fetch }) {
    this.#fetch = fetch
  }

  async updateHealth() {
    this.isHealthy = true
  }

  resetHealth() {
    this.isHealthy = null
  }

  areChainsSupported({ fromChainId, toChainId }: { fromChainId: number; toChainId: number }) {
    return fromChainId === toChainId && !!getApiNetwork(fromChainId)
  }

  #getApiUrl(chainId: number, path: string) {
    const apiNetwork = getApiNetwork(chainId)
    if (!apiNetwork) {
      throw new SwapAndBridgeProviderApiError(
        'The requested network is not supported by our service provider CoW Swap.'
      )
    }

    return `${COWSWAP_API_BASE_URL}/${apiNetwork}/api/v1${path}`
  }

  async #fetchWithTimeout(url: string, init?: RequestInitWithCustomHeaders) {
    let timeout: NodeJS.Timeout | undefined

    try {
      return await Promise.race([
        this.#fetch(url, init),
        new Promise<CustomResponse>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new SwapAndBridgeProviderApiError(
                'Our service provider CoW Swap is temporarily unavailable or your internet connection is too slow.'
              )
            )
          }, this.#requestTimeoutMs)
        })
      ])
    } catch (error: any) {
      if (error instanceof SwapAndBridgeProviderApiError) throw error

      const message = error?.message || 'no message'
      throw new SwapAndBridgeProviderApiError(
        `Our service provider CoW Swap could not be reached. Error details: <${message}>`
      )
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async #parseResponse<T>(response: CustomResponse, errorPrefix: string): Promise<T> {
    if (response.status === 429) {
      throw new SwapAndBridgeProviderApiError(
        `${errorPrefix} CoW Swap received too many requests. Please try again shortly.`
      )
    }

    let body: T
    try {
      body = await response.json()
    } catch (error: any) {
      const message = error?.message || 'no message'
      throw new SwapAndBridgeProviderApiError(
        `${errorPrefix} CoW Swap returned an unexpected response. Error details: <${message}>`
      )
    }

    if (!response.ok) {
      const errorBody = body as CowSwapErrorResponse
      const message =
        errorBody.description || errorBody.message || errorBody.errorType || 'Unknown error'
      throw new SwapAndBridgeProviderApiError(`${errorPrefix} CoW Swap responded: <${message}>`)
    }

    return body
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const chains = COWSWAP_SUPPORTED_CHAINS.map(({ chainId }) => ({ chainId }))
    this.supportedChains = chains
    return chains
  }

  async getToTokenList({
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SwapAndBridgeToToken[]> {
    if (!this.areChainsSupported({ fromChainId, toChainId })) {
      throw new SwapAndBridgeProviderApiError(
        'The requested network pair is not supported by our service provider CoW Swap.'
      )
    }

    // TODO: fix this, especially in a setup where CowSwap is the only provider

    // CoW Swap does not expose a token-list endpoint. The shared token picker is populated by
    // the other providers, while CoW Swap can quote any selected supported ERC-20 token.
    return []
  }

  async getToken(): Promise<SwapAndBridgeToToken | null> {
    return null
  }

  async quote({
    fromAsset,
    fromChainId,
    fromTokenAddress,
    toAsset,
    toChainId,
    toTokenAddress,
    fromAmount,
    userAddress,
    isWrapOrUnwrap
  }: ProviderQuoteParams): Promise<SwapAndBridgeQuote> {
    if (!this.areChainsSupported({ fromChainId, toChainId })) {
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but CoW Swap supports only same-network swaps on this network.'
      )
    }
    if (!fromAsset || !toAsset) {
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but token details are missing. Please select the tokens again.'
      )
    }
    const isEthFlow = fromTokenAddress.toLowerCase() === ZeroAddress.toLowerCase()
    const wrappedNativeTokenAddress = getWrappedNativeTokenAddress(fromChainId)
    if (isEthFlow && !wrappedNativeTokenAddress) {
      throw new SwapAndBridgeProviderApiError(
        'CoW Swap cannot sell the network native token on this network.'
      )
    }

    const sellToken = getAddress(isEthFlow ? wrappedNativeTokenAddress! : fromTokenAddress)
    const buyToken = normalizeBuyTokenAddress(toTokenAddress)
    const owner = getAddress(userAddress)
    const slippageBps = Math.round(Number(getSlippage(fromAsset, fromAmount, '0.5', 0.5)) * 100)
    const withConvenienceFee = !isWrapOrUnwrap && !isNoFeeToken(fromChainId, sellToken)
    const { fullAppData, appDataHash } = buildAppData({ slippageBps, withConvenienceFee })
    const quoteRequest = {
      sellToken,
      buyToken,
      receiver: owner,
      from: owner,
      sellAmountBeforeFee: fromAmount.toString(),
      kind: 'sell',
      validFor: COWSWAP_ORDER_VALIDITY_SECONDS,
      appData: fullAppData,
      appDataHash,
      priceQuality: 'optimal',
      signingScheme: isEthFlow ? 'eip1271' : 'presign',
      ...(isEthFlow
        ? {
            onchainOrder: true,
            verificationGasLimit: 0
          }
        : {})
    }
    const response = await this.#fetchWithTimeout(this.#getApiUrl(fromChainId, '/quote'), {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(quoteRequest)
    })
    const quoteResponse = await this.#parseResponse<CowSwapQuoteResponse>(
      response,
      'Unable to fetch the quote.'
    )
    const quotedOrder = quoteResponse.quote
    if (
      !quotedOrder ||
      typeof quotedOrder.sellToken !== 'string' ||
      typeof quotedOrder.buyToken !== 'string' ||
      typeof quotedOrder.receiver !== 'string' ||
      typeof quotedOrder.sellAmount !== 'string' ||
      typeof quotedOrder.buyAmount !== 'string' ||
      typeof quotedOrder.feeAmount !== 'string' ||
      typeof quotedOrder.appData !== 'string'
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned incomplete order details.'
      )
    }
    const returnedAppDataHash =
      quotedOrder.appDataHash ||
      (quotedOrder.appData.startsWith('0x') && quotedOrder.appData.length === 66
        ? quotedOrder.appData
        : null)
    if (
      quotedOrder.sellToken.toLowerCase() !== sellToken.toLowerCase() ||
      quotedOrder.buyToken.toLowerCase() !== buyToken.toLowerCase() ||
      quotedOrder.receiver.toLowerCase() !== owner.toLowerCase() ||
      quotedOrder.kind !== 'sell' ||
      quotedOrder.partiallyFillable !== false ||
      quotedOrder.signingScheme !== (isEthFlow ? 'eip1271' : 'presign') ||
      returnedAppDataHash?.toLowerCase() !== appDataHash.toLowerCase() ||
      !Number.isInteger(quotedOrder.validTo) ||
      quotedOrder.validTo <= Math.floor(Date.now() / 1000) ||
      !Number.isSafeInteger(quoteResponse.id) ||
      Number(quoteResponse.id) < 0
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned order details that do not match your request.'
      )
    }
    let quotedSellAmount: bigint
    let quotedBuyAmount: bigint
    let networkFee: bigint
    try {
      quotedSellAmount = BigInt(quotedOrder.sellAmount)
      quotedBuyAmount = BigInt(quotedOrder.buyAmount)
      networkFee = BigInt(quotedOrder.feeAmount)
    } catch {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned invalid token amounts.'
      )
    }
    const sellAmount = quotedSellAmount + networkFee

    if (sellAmount !== fromAmount || quotedSellAmount <= 0n) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned an unexpected spend amount.'
      )
    }

    const protocolFeeBps = Number(quoteResponse.protocolFeeBps || 0)
    if (!Number.isFinite(protocolFeeBps) || protocolFeeBps < 0) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned an invalid fee.'
      )
    }

    const networkFeeInBuyToken = (quotedBuyAmount * networkFee) / quotedSellAmount
    const protocolFee = getProtocolFeeAmount(quotedBuyAmount, protocolFeeBps)
    const buyAmountBeforeFees = quotedBuyAmount + networkFeeInBuyToken + protocolFee
    const partnerFee = withConvenienceFee
      ? (buyAmountBeforeFees * BigInt(AMBIRE_FEE_BPS)) / 10000n
      : 0n
    const toAmount = quotedBuyAmount - partnerFee
    const minAmountOut = toAmount - (toAmount * BigInt(slippageBps)) / 10000n

    if (toAmount <= 0n || minAmountOut <= 0n) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. The expected receive amount is too low.'
      )
    }

    const order: CowSwapOrderCreation = {
      sellToken,
      buyToken,
      receiver: owner,
      sellAmount: sellAmount.toString(),
      buyAmount: minAmountOut.toString(),
      validTo: quotedOrder.validTo,
      appData: fullAppData,
      appDataHash,
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: isEthFlow ? 'eip1271' : 'presign',
      signature: '0x',
      from: owner,
      quoteId: quoteResponse.id ?? null
    }
    const orderUid = computeOrderUid({ chainId: fromChainId, order, owner, isEthFlow })
    const normalizedFromAsset = convertPortfolioTokenToSwapAndBridgeToToken(fromAsset, fromChainId)
    const protocol = { name: 'CoW Swap', displayName: 'CoW Swap', icon: '' }
    const serviceTime = 30
    const inputValueInUsd = Number(getTokenUsdAmount(fromAsset, sellAmount) || 0)
    const outputValueInUsd = getOutputValueInUsd({
      inputValueInUsd,
      toAsset,
      toAmount: toAmount.toString(),
      buyAmountBeforeFees
    })
    const userTx: SwapAndBridgeUserTx = {
      userTxIndex: 0,
      fromAsset: normalizedFromAsset,
      toAsset,
      chainId: fromChainId,
      fromAmount: sellAmount.toString(),
      toAmount: toAmount.toString(),
      swapSlippage: slippageBps / 100,
      serviceTime,
      protocol,
      minAmountOut: minAmountOut.toString()
    }
    const step: SwapAndBridgeStep = { ...userTx, type: 'swap' }
    const rawRoute: CowSwapRawRoute = { quoteResponse, order, isEthFlow }
    const route: SwapAndBridgeRoute = {
      providerId: this.id,
      routeId: orderUid,
      currentUserTxIndex: 0,
      fromChainId,
      toChainId,
      userAddress: owner,
      isOnlySwapRoute: true,
      fromAmount: sellAmount.toString(),
      toAmount: toAmount.toString(),
      usedDexName: 'CoW Swap',
      userTxs: [userTx],
      sender: owner,
      steps: [step],
      inputValueInUsd,
      outputValueInUsd,
      serviceTime,
      rawRoute,
      toToken: {
        address: toAsset.address,
        chainId: toAsset.chainId,
        decimals: toAsset.decimals,
        logoURI: toAsset.icon || '',
        name: toAsset.name,
        priceUSD: toAsset.priceUSD,
        symbol: toAsset.symbol
      } as any,
      disabled: false,
      withConvenienceFee,
      isIntent: true
    }

    return {
      fromAsset: normalizedFromAsset,
      fromChainId,
      toAsset,
      toChainId,
      selectedRoute: undefined,
      selectedRouteSteps: [],
      routes: [route]
    }
  }

  async startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest> {
    if (
      !this.areChainsSupported({ fromChainId: route.fromChainId, toChainId: route.toChainId }) ||
      !('order' in route.rawRoute) ||
      typeof route.rawRoute.order.from !== 'string' ||
      route.rawRoute.order.from.toLowerCase() !== route.userAddress.toLowerCase()
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the CoW Swap route because the order details do not match your account.'
      )
    }
    const rawRoute = route.rawRoute

    let orderUid: string
    try {
      orderUid = computeOrderUid({
        chainId: route.fromChainId,
        order: rawRoute.order,
        owner: route.userAddress,
        isEthFlow: rawRoute.isEthFlow
      })
    } catch {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the CoW Swap route because the order details are invalid.'
      )
    }
    if (orderUid !== route.routeId) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the CoW Swap route because the order details changed.'
      )
    }

    if (rawRoute.isEthFlow) {
      const wrappedNativeTokenAddress = getWrappedNativeTokenAddress(route.fromChainId)
      const quoteId = rawRoute.order.quoteId
      const quotedOrder = rawRoute.quoteResponse.quote
      if (
        !wrappedNativeTokenAddress ||
        rawRoute.order.signingScheme !== 'eip1271' ||
        quotedOrder.signingScheme !== 'eip1271' ||
        rawRoute.order.sellToken.toLowerCase() !== wrappedNativeTokenAddress.toLowerCase() ||
        rawRoute.order.receiver.toLowerCase() === ZeroAddress.toLowerCase() ||
        rawRoute.order.validTo !== quotedOrder.validTo ||
        quoteId !== rawRoute.quoteResponse.id ||
        !Number.isSafeInteger(quoteId) ||
        Number(quoteId) < 0 ||
        keccak256(toUtf8Bytes(rawRoute.order.appData)).toLowerCase() !==
          rawRoute.order.appDataHash.toLowerCase()
      ) {
        throw new SwapAndBridgeProviderApiError(
          'Unable to start the CoW Swap route because the ETH order details changed.'
        )
      }

      await this.#uploadAppData(
        route.fromChainId,
        rawRoute.order.appDataHash,
        rawRoute.order.appData
      )

      let value: string
      try {
        value = (BigInt(rawRoute.order.sellAmount) + BigInt(rawRoute.order.feeAmount)).toString()
      } catch {
        throw new SwapAndBridgeProviderApiError(
          'Unable to start the CoW Swap route because the ETH amount is invalid.'
        )
      }

      return {
        activeRouteId: route.routeId,
        approvalData: null,
        chainId: route.fromChainId,
        txTarget: COWSWAP_ETH_FLOW_ADDRESS,
        userTxIndex: 0,
        value,
        txData: ethFlowInterface.encodeFunctionData('createOrder', [
          {
            buyToken: rawRoute.order.buyToken,
            receiver: rawRoute.order.receiver,
            sellAmount: rawRoute.order.sellAmount,
            buyAmount: rawRoute.order.buyAmount,
            appData: rawRoute.order.appDataHash,
            feeAmount: rawRoute.order.feeAmount,
            validTo: rawRoute.order.validTo,
            partiallyFillable: rawRoute.order.partiallyFillable,
            quoteId
          }
        ])
      }
    }

    if (rawRoute.order.signingScheme !== 'presign') {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the CoW Swap route because the order signing method changed.'
      )
    }

    return {
      activeRouteId: route.routeId,
      approvalData: {
        allowanceTarget: COWSWAP_VAULT_RELAYER_ADDRESS,
        approvalTokenAddress: rawRoute.order.sellToken,
        minimumApprovalAmount: rawRoute.order.sellAmount,
        owner: route.userAddress
      },
      chainId: route.fromChainId,
      txTarget: COWSWAP_SETTLEMENT_ADDRESS,
      userTxIndex: 0,
      value: '0',
      txData: settlementInterface.encodeFunctionData('setPreSignature', [route.routeId, true])
    }
  }

  async #getOrder(chainId: number, orderUid: string): Promise<CowSwapOrderResponse | null> {
    const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, `/orders/${orderUid}`), {
      headers: this.#headers
    })
    if (response.status === 404) return null

    return this.#parseResponse<CowSwapOrderResponse>(
      response,
      'Unable to check the CoW Swap order.'
    )
  }

  async #uploadAppData(chainId: number, appDataHash: string, fullAppData: string) {
    const response = await this.#fetchWithTimeout(
      this.#getApiUrl(chainId, `/app_data/${appDataHash}`),
      {
        method: 'PUT',
        headers: this.#headers,
        body: JSON.stringify({ fullAppData })
      }
    )

    await this.#parseResponse(response, 'Unable to prepare the CoW Swap order.')
  }

  async #submitOrder(chainId: number, rawRoute: CowSwapRawRoute, orderUid: string) {
    let computedOrderUid: string
    try {
      computedOrderUid = computeOrderUid({
        chainId,
        order: rawRoute.order,
        owner: rawRoute.order.from,
        isEthFlow: false
      })
    } catch {
      throw new SwapAndBridgeProviderApiError(
        'Unable to submit the CoW Swap order because its details are invalid.'
      )
    }
    if (computedOrderUid !== orderUid) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to submit the CoW Swap order because its details changed.'
      )
    }

    const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, '/orders'), {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(rawRoute.order)
    })

    let body: string | CowSwapErrorResponse
    try {
      body = await response.json()
    } catch (error: any) {
      const message = error?.message || 'no message'
      throw new SwapAndBridgeProviderApiError(
        `Unable to submit the CoW Swap order. CoW Swap returned an unexpected response. Error details: <${message}>`
      )
    }

    if (response.ok) {
      if (body !== orderUid) {
        throw new SwapAndBridgeProviderApiError(
          'Unable to submit the CoW Swap order because its identifier did not match the approved order.'
        )
      }
      return true
    }

    const errorBody = body as CowSwapErrorResponse
    if (errorBody.errorType === 'DuplicatedOrder') return true
    if (errorBody.errorType === 'InsufficientAllowance') {
      // The approval and PreSign calls are in the same Ambire operation. CoW's order service can
      // briefly lag behind the mined approval, so status polling retries submission on the next pass.
      return false
    }

    const message =
      errorBody.description || errorBody.message || errorBody.errorType || 'Unknown error'
    throw new SwapAndBridgeProviderApiError(
      `Unable to submit the CoW Swap order. CoW Swap responded: <${message}>`
    )
  }

  async #getSettlementTransaction(chainId: number, orderUid: string) {
    const params = new URLSearchParams({ orderUid })
    const response = await this.#fetchWithTimeout(
      this.#getApiUrl(chainId, `/trades?${params.toString()}`),
      { headers: this.#headers }
    )
    const trades = await this.#parseResponse<CowSwapTrade[]>(
      response,
      'Unable to retrieve the completed CoW Swap transaction.'
    )

    return trades.find((trade) => trade.txHash)?.txHash || null
  }

  async getRouteStatus({
    fromChainId,
    routeId,
    rawRoute
  }: {
    txHash: string
    fromChainId: number
    toChainId: number
    routeId?: string
    rawRoute?: SwapAndBridgeRoute['rawRoute']
  }): Promise<SwapAndBridgeRouteStatusResult> {
    if (!routeId || !rawRoute || !('order' in rawRoute)) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to check the CoW Swap order because its details are missing.'
      )
    }

    let order = await this.#getOrder(fromChainId, routeId)
    if (!order) {
      if (rawRoute.isEthFlow) return { status: null }
      const wasSubmitted = await this.#submitOrder(fromChainId, rawRoute, routeId)
      if (!wasSubmitted) return { status: null }
      order = await this.#getOrder(fromChainId, routeId)
    }

    if (!order || order.status === 'presignaturePending' || order.status === 'open') {
      return { status: null }
    }
    if (order.status === 'fulfilled') {
      return {
        status: 'completed',
        txnId: await this.#getSettlementTransaction(fromChainId, routeId)
      }
    }

    return { status: 'failed' }
  }
}
