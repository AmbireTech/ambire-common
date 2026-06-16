import { getAddress, ZeroAddress } from 'ethers'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  ProviderQuoteParams,
  SquidErrorResponse,
  SquidRoute,
  SquidRouteResponse,
  SquidStatusResponse,
  SquidToken,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatus,
  SwapAndBridgeRouteStatusResult,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapAndBridgeUserTx,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import {
  addCustomTokensIfNeeded,
  convertPortfolioTokenToSwapAndBridgeToToken,
  getSlippage,
  isNoFeeToken,
  sortNativeTokenFirst
} from '../../libs/swapAndBridge/swapAndBridge'
import {
  AMBIRE_FEE_TAKER_ADDRESS,
  CITREA_CHAIN_ID,
  SQUID_API_BASE_URL,
  SQUID_NATIVE_TOKEN_ADDRESS
} from './constants'

const normalizeOutgoingSquidTokenAddress = (address: string) =>
  address === ZeroAddress ? SQUID_NATIVE_TOKEN_ADDRESS : address

const isTransientSquidStatusNotFound = (response: SquidErrorResponse) =>
  response.statusCode === 404 || response.type === 'NotFoundError'

const getTxnIdFromTransactionUrl = (transactionUrl?: string) =>
  transactionUrl?.match(/0x[a-fA-F0-9]{64}/)?.[0] || null

const normalizeIncomingSquidTokenAddress = (address: string) =>
  address.toLowerCase() === SQUID_NATIVE_TOKEN_ADDRESS.toLowerCase()
    ? ZeroAddress
    : getAddress(address)

const normalizeSquidTokenToSwapAndBridgeToToken = (token: SquidToken): SwapAndBridgeToToken => ({
  name: token.name,
  address: normalizeIncomingSquidTokenAddress(token.address),
  decimals: token.decimals,
  symbol: token.symbol,
  icon: token.logoURI,
  chainId: Number(token.chainId)
})

const getSquidProtocol = (route: SquidRoute) => {
  const routeSteps = [
    ...(route.estimate.route?.fromChain || []),
    ...(route.estimate.route?.toChain || [])
  ]
  const firstNamedStep = routeSteps.find((step) => step.dex)

  return {
    name: firstNamedStep?.dex || 'Squid',
    displayName: firstNamedStep?.dex || 'Squid',
    icon: firstNamedStep?.logoURI || ''
  }
}

const normalizeSquidRouteToSwapAndBridgeRoute = ({
  route,
  fromAsset,
  fromChainId,
  toAsset,
  toChainId,
  userAddress,
  accountNativeBalance,
  nativeSymbol,
  withConvenienceFee
}: {
  route: SquidRoute
  fromAsset: SwapAndBridgeToToken
  fromChainId: number
  toAsset: SwapAndBridgeToToken
  toChainId: number
  userAddress: string
  accountNativeBalance: bigint
  nativeSymbol: string
  withConvenienceFee: boolean
}): SwapAndBridgeRoute => {
  const fromAmount = route.estimate.fromAmount || route.params?.fromAmount || '0'
  const toAmount = route.estimate.toAmount
  const serviceTime = route.estimate.estimatedRouteDuration || 0
  const protocol = getSquidProtocol(route)
  const minAmountOut = route.estimate.toAmountMin || toAmount
  const gasCostsInUsd = route.estimate.gasCosts?.reduce(
    (total, gasCost) => total + Number(gasCost.amountUSD || 0),
    0
  )
  const serviceFeeCost = route.estimate.feeCosts?.find((fee) => fee.included === false)
  const serviceFee = serviceFeeCost
    ? {
        amount: serviceFeeCost.amount,
        amountUSD: serviceFeeCost.amountUSD || '0'
      }
    : undefined
  const disabled =
    serviceFee === undefined ? false : accountNativeBalance < BigInt(serviceFee.amount)
  const disabledReason = disabled
    ? `Insufficient ${nativeSymbol}. This bridge imposes a fee that must be paid in ${nativeSymbol}.`
    : undefined

  const userTx: SwapAndBridgeUserTx = {
    userTxIndex: 0,
    fromAsset,
    toAsset,
    chainId: fromChainId,
    fromAmount,
    toAmount,
    swapSlippage: route.estimate.aggregatePriceImpact
      ? Number(route.estimate.aggregatePriceImpact)
      : undefined,
    serviceTime,
    protocol,
    minAmountOut
  }

  const step = {
    ...userTx,
    type: 'swap' as const
  }

  return {
    providerId: 'squid',
    routeId: route.quoteId,
    fromChainId,
    toChainId,
    userAddress,
    isOnlySwapRoute: false,
    fromAmount,
    toAmount,
    currentUserTxIndex: 0,
    usedBridgeNames: ['squid'],
    userTxs: [userTx],
    steps: [step],
    inputValueInUsd: Number(route.estimate.fromAmountUSD || 0),
    outputValueInUsd: Number(route.estimate.toAmountUSD || 0),
    outputValueAfterGasInUsd:
      gasCostsInUsd === undefined
        ? undefined
        : Number(route.estimate.toAmountUSD || 0) - gasCostsInUsd,
    serviceTime,
    rawRoute: route,
    sender: userAddress,
    toToken: {
      address: toAsset.address,
      chainId: toAsset.chainId,
      decimals: toAsset.decimals,
      logoURI: toAsset.icon || '',
      name: toAsset.name,
      symbol: toAsset.symbol
    } as any,
    disabled,
    disabledReason,
    serviceFee,
    withConvenienceFee
  }
}

export class SquidAPI implements SwapProvider {
  id: string = 'squid'

  name: string = 'Squid'

  #fetch: Fetch

  #headers: RequestInitWithCustomHeaders['headers']

  #requestTimeoutMs = 15000

  isHealthy: boolean | null = null

  supportedChains: SwapProvider['supportedChains'] = null

  constructor({ fetch, integratorId }: { fetch: Fetch; integratorId: string }) {
    this.#fetch = fetch

    this.#headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    if (integratorId) this.#headers['x-integrator-id'] = integratorId
  }

  async getHealth() {
    return true
  }

  async updateHealth() {
    this.isHealthy = await this.getHealth()
  }

  resetHealth() {
    this.isHealthy = null
  }

  areChainsSupported({ fromChainId, toChainId }: { fromChainId: number; toChainId: number }) {
    return fromChainId === CITREA_CHAIN_ID || toChainId === CITREA_CHAIN_ID
  }

  #ensureIntegratorId() {
    if (this.#headers['x-integrator-id']) return

    throw new SwapAndBridgeProviderApiError(
      'Our service provider Squid is not configured yet. Error details: <missing SQUID_INTEGRATOR_ID>'
    )
  }

  async #handleResponse<T>({
    fetchPromise,
    errorPrefix,
    shouldReturnErrorResponse
  }: {
    fetchPromise: Promise<CustomResponse>
    errorPrefix: string
    shouldReturnErrorResponse?: (responseBody: any, response: CustomResponse) => boolean
  }): Promise<T> {
    let response: CustomResponse

    try {
      let timeoutPromise: NodeJS.Timeout | undefined
      response = await Promise.race([
        fetchPromise,
        new Promise<CustomResponse>((_, reject) => {
          timeoutPromise = setTimeout(() => {
            reject(
              new SwapAndBridgeProviderApiError(
                'Our service provider Squid is temporarily unavailable or your internet connection is too slow.'
              )
            )
          }, this.#requestTimeoutMs)
        })
      ])

      if (timeoutPromise) clearTimeout(timeoutPromise)
    } catch (e: any) {
      if (e instanceof SwapAndBridgeProviderApiError) throw e

      const status = e?.status ? `, status: <${e.status}>` : ''
      const error = `${errorPrefix} Our service provider Squid could not be reached: ${status}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    let responseBody: T
    try {
      responseBody = await response.json()
    } catch (e: any) {
      const message = e?.message || 'no message'
      const error = `${errorPrefix} Error details: <Unexpected non-JSON response from our service provider Squid>, message: <${message}>`
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (!response.ok) {
      if (shouldReturnErrorResponse && shouldReturnErrorResponse(responseBody, response)) {
        return responseBody
      }

      const upstreamBody = responseBody as any
      const upstreamMessage =
        upstreamBody?.message ||
        upstreamBody?.error ||
        upstreamBody?.errors?.[0]?.message ||
        JSON.stringify(upstreamBody).slice(0, 250)
      const error = `${errorPrefix} Our service provider Squid responded: <${upstreamMessage}>`
      throw new SwapAndBridgeProviderApiError(error)
    }

    return responseBody
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const chains = [{ chainId: CITREA_CHAIN_ID }]
    this.supportedChains = chains

    return chains
  }

  async getToTokenList({ toChainId }: { toChainId: number }): Promise<SwapAndBridgeToToken[]> {
    this.#ensureIntegratorId()

    const params = new URLSearchParams({
      chainId: toChainId.toString()
    })

    const response = await this.#handleResponse<SquidToken[] | { tokens: SquidToken[] }>({
      fetchPromise: this.#fetch(`${SQUID_API_BASE_URL}/tokens?${params.toString()}`, {
        headers: this.#headers
      }),
      errorPrefix:
        'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
    })

    const tokens = (Array.isArray(response) ? response : response.tokens || [])
      .filter((token) => Number(token.chainId) === toChainId)
      .map(normalizeSquidTokenToSwapAndBridgeToToken)

    const withCustomTokens = addCustomTokensIfNeeded({ chainId: toChainId, tokens })

    return sortNativeTokenFirst(withCustomTokens)
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null> {
    const tokens = await this.getToTokenList({ toChainId: chainId })
    const normalizedAddress = normalizeIncomingSquidTokenAddress(
      normalizeOutgoingSquidTokenAddress(address)
    )

    return tokens.find((token) => token.address === normalizedAddress) || null
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
    isWrapOrUnwrap,
    accountNativeBalance,
    nativeSymbol
  }: ProviderQuoteParams): Promise<SwapAndBridgeQuote> {
    this.#ensureIntegratorId()

    if (!this.areChainsSupported({ fromChainId, toChainId }))
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but Squid only supports swaps on Citrea and bridges to or from Citrea.'
      )
    if (!fromAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <from token details are missing>'
      )
    if (!toAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <to token details are missing>'
      )

    const feeTakerAddress = AMBIRE_FEE_TAKER_ADDRESS
    const shouldIncludeConvenienceFee =
      !!feeTakerAddress && !isWrapOrUnwrap && !isNoFeeToken(fromChainId, fromTokenAddress)

    const body: {
      fromAddress: string
      fromChain: string
      fromToken: string
      fromAmount: string
      toChain: string
      toToken: string
      toAddress: string
      slippage: number
      quoteOnly: boolean
    } = {
      fromAddress: userAddress,
      fromChain: fromChainId.toString(),
      fromToken: normalizeOutgoingSquidTokenAddress(fromTokenAddress),
      fromAmount: fromAmount.toString(),
      toChain: toChainId.toString(),
      toToken: normalizeOutgoingSquidTokenAddress(toTokenAddress),
      toAddress: userAddress,
      slippage: Number(getSlippage(fromAsset, fromAmount, '1', 0.5)),
      quoteOnly: false
    }

    const response = await this.#handleResponse<SquidRouteResponse>({
      fetchPromise: this.#fetch(`${SQUID_API_BASE_URL}/route`, {
        method: 'POST',
        headers: this.#headers,
        body: JSON.stringify(body)
      }),
      errorPrefix: 'Unable to fetch the quote.'
    })

    const requestId = response.route.requestId || response.route.quoteId
    const route = {
      ...response.route,
      requestId
    }
    const normalizedFromAsset = convertPortfolioTokenToSwapAndBridgeToToken(fromAsset, fromChainId)

    return {
      fromAsset: normalizedFromAsset,
      fromChainId,
      toAsset,
      toChainId,
      routes: [
        normalizeSquidRouteToSwapAndBridgeRoute({
          route,
          fromAsset: normalizedFromAsset,
          fromChainId,
          toAsset,
          toChainId,
          userAddress,
          accountNativeBalance,
          nativeSymbol,
          withConvenienceFee: shouldIncludeConvenienceFee
        })
      ],
      selectedRoute: undefined,
      selectedRouteSteps: []
    }
  }

  async startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest> {
    const rawRoute = route.rawRoute as SquidRoute
    const transactionRequest = rawRoute.transactionRequest
    const txTarget = transactionRequest?.target || transactionRequest?.to
    const txData = transactionRequest?.data

    if (!txTarget || !txData || typeof transactionRequest?.value !== 'string') {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the route. Error details: <missing transaction request data>'
      )
    }

    return {
      activeRouteId: route.routeId,
      approvalData:
        route.steps[0]?.fromAsset.address === ZeroAddress
          ? null
          : {
              allowanceTarget: rawRoute.estimate.approvalAddress || txTarget,
              approvalTokenAddress: route.steps[0]!.fromAsset.address,
              minimumApprovalAmount: route.fromAmount,
              owner: route.userAddress
            },
      chainId: route.fromChainId,
      txTarget,
      userTxIndex: 0,
      value: transactionRequest.value,
      txData
    }
  }

  async getRouteStatus({
    txHash,
    fromChainId,
    toChainId,
    requestId,
    routeId
  }: {
    txHash: string
    fromChainId: number
    toChainId: number
    requestId?: string
    routeId?: string
  }): Promise<SwapAndBridgeRouteStatusResult> {
    this.#ensureIntegratorId()

    const params = new URLSearchParams({
      transactionId: txHash,
      fromChainId: fromChainId.toString(),
      toChainId: toChainId.toString()
    })
    if (requestId) params.append('requestId', requestId)
    if (routeId) params.append('quoteId', routeId)

    const response = await this.#handleResponse<SquidStatusResponse | SquidErrorResponse>({
      fetchPromise: this.#fetch(`${SQUID_API_BASE_URL}/status?${params.toString()}`, {
        headers: this.#headers
      }),
      errorPrefix: 'Unable to get the route status. Please check back later to proceed.',
      shouldReturnErrorResponse: (responseBody) =>
        isTransientSquidStatusNotFound(responseBody as SquidErrorResponse)
    })

    if (isTransientSquidStatusNotFound(response as SquidErrorResponse)) {
      return { status: null }
    }

    const statusResponse = response as SquidStatusResponse
    const status = (
      statusResponse.squidTransactionStatus ||
      statusResponse.status ||
      ''
    ).toLowerCase()
    let routeStatus: SwapAndBridgeRouteStatus = null

    if (status === 'success' || status === 'partial_success') routeStatus = 'completed'
    if (status === 'refund') routeStatus = 'refunded'

    return {
      status: routeStatus,
      txnId: getTxnIdFromTransactionUrl(statusResponse.toChain?.transactionUrl)
    }
  }
}
