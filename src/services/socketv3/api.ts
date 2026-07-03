import { getAddress } from 'ethers'
import { ethAddress, zeroAddress } from 'viem'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  ProviderQuoteParams,
  SocketAPISupportedChain,
  SocketAPIToken,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatusResult,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import {
  addCustomTokensIfNeeded,
  convertNullAddressToZeroAddressIfNeeded,
  isNoFeeToken
} from '../../libs/swapAndBridge/swapAndBridge'
import { CITREA_CHAIN_ID } from '../squid/constants'
import {
  AMBIRE_FEE_TAKER_ADDRESSES,
  ETH_ON_OPTIMISM_LEGACY_ADDRESS,
  FEE_PERCENT
} from './constants'

type SocketV3Protocol = {
  name: string
  displayName?: string
  icon?: string
}

type SocketV3RouteDetails = {
  name?: string
  logoURI?: string
  dexDetails?: {
    protocol?: SocketV3Protocol
    amountIn?: string
    amountOut?: string
    minAmountOut?: string
    slippage?: number
  } | null
  bridgeDetails?: {
    protocol?: SocketV3Protocol
    amountIn?: string
    amountOut?: string
    minAmountOut?: string
    slippage?: number
  } | null
  feeDetails?: {
    amount?: string
    feeInUsd?: number
    token?: SocketAPIToken
  } | null
}

type SocketV3Approval = {
  amount: string
  tokenAddress: string
  spenderAddress: string
  userAddress: string
}

type SocketV3TxData = {
  kind: string
  object: {
    chainId?: number
    to: string
    data: string
    value?: string
  }
}

type SocketV3Route = {
  userOp: 'tx'
  quoteId: string
  expiresAt?: number
  output: {
    amount: string
    minAmountOut: string
    priceInUsd: number
    token: SocketAPIToken
    valueInUsd: number
  }
  estimatedTime?: number
  slippage?: number
  suggestedSlippage?: number
  routeTags?: string[]
  routeDetails?: SocketV3RouteDetails | null
  approval?: SocketV3Approval | null
  txData?: SocketV3TxData | null
  gasFee?: {
    feeInUsd?: number | string
  } | null
}

type SocketV3QuoteResponse = {
  originChainId: number
  destinationChainId: number
  userAddress: string
  receiverAddress: string
  input: {
    token: SocketAPIToken
    amount: string
    priceInUsd: number
    valueInUsd: number
  }
  routes: SocketV3Route[]
}

type SocketV3StatusResponse = {
  quoteId: string
  status?: string
  statusCode?: string
  origin?: {
    status?: string
    txHash?: string | null
  }
  destination?: {
    status?: string
    txHash?: string | null
  }
  refund?: {
    txHash?: string | null
  } | null
}

const convertZeroAddressToNullAddressIfNeeded = (addr: string) =>
  addr === zeroAddress ? ethAddress : addr

const normalizeIncomingSocketTokenAddress = (address: string) =>
  // incoming token addresses from Socket are all lowercased
  getAddress(
    // native token addresses come as null address instead of the zero address
    convertNullAddressToZeroAddressIfNeeded(address)
  )

export const normalizeIncomingSocketToken = (token: SocketAPIToken) => ({
  ...token,
  icon: token.icon || token.logoURI || '',
  logoURI: token.logoURI || token.icon || '',
  address: normalizeIncomingSocketTokenAddress(token.address)
})

const normalizeOutgoingSocketTokenAddress = (address: string) =>
  // Socket expects to receive null address instead of the zero address for native tokens.
  convertZeroAddressToNullAddressIfNeeded(
    // Socket works only with all lowercased token addresses, otherwise, bad request
    address.toLocaleLowerCase()
  )

const getRouteProtocol = (route: SocketV3Route): SocketV3Protocol => {
  const details = route.routeDetails
  const protocol = details?.bridgeDetails?.protocol || details?.dexDetails?.protocol
  if (protocol) return protocol

  return {
    name: details?.name || 'Socket',
    displayName: details?.name || 'Socket',
    icon: details?.logoURI || ''
  }
}

const getNativeValue = (route: SocketV3Route) => {
  try {
    return BigInt(route.txData?.object.value || '0')
  } catch (e) {
    console.error(e)
    return 0n
  }
}

const getStatusTxnId = (response: SocketV3StatusResponse, fallbackTxnId: string) =>
  response.destination?.txHash ||
  response.refund?.txHash ||
  response.origin?.txHash ||
  fallbackTxnId

export class SocketV3API implements SwapProvider {
  id: string = 'socketv3'

  name = 'Socket'

  #fetch: Fetch

  #requestTimeoutMs = 15000

  #socketApiUrl = 'https://dedicated-backend.socket.tech'

  #headers: RequestInitWithCustomHeaders['headers']

  isHealthy: boolean | null = null

  supportedChains: SwapProvider['supportedChains'] = null

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#fetch = fetch

    this.#headers = {
      'x-api-key': apiKey,
      affiliate:
        '609913096e183b62cecd0dfdc13382f618baedceb5fef75aad43e6cbff367039708902197e0b2b78b1d76cb0837ad0b318baedceb5fef75aad43e6cb',
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }

  async getHealth() {
    // deprecated mechanism
    return true
  }

  async updateHealth() {
    this.isHealthy = await this.getHealth()
  }

  async updateHealthIfNeeded() {
    // Update health status only if previously unhealthy
    if (this.isHealthy) return

    await this.updateHealth()
  }

  resetHealth() {
    this.isHealthy = null
  }

  /** disable explicitly citrea for socket */
  areChainsSupported({ fromChainId, toChainId }: { fromChainId: number; toChainId: number }) {
    return fromChainId !== CITREA_CHAIN_ID && toChainId !== CITREA_CHAIN_ID
  }

  /**
   * Processes Socket API responses and throws custom errors for various
   * failures, including handling the API's unique response structure.
   */
  async #handleResponse<T>({
    fetchPromise,
    errorPrefix
  }: {
    fetchPromise: Promise<CustomResponse>
    errorPrefix: string
  }): Promise<T> {
    let response: CustomResponse
    let timeoutPromise: ReturnType<typeof setTimeout> | undefined

    try {
      response = await Promise.race([
        fetchPromise,
        new Promise<CustomResponse>((_, reject) => {
          timeoutPromise = setTimeout(() => {
            reject(
              new SwapAndBridgeProviderApiError(
                'Our service provider Socket is temporarily unavailable or your internet connection is too slow.'
              )
            )
          }, this.#requestTimeoutMs)
        })
      ])
    } catch (e: any) {
      const message = e?.message || 'no message'
      const status = e?.status ? `, status: <${e.status}>` : ''
      const error = `${errorPrefix} Upstream error: <${message}>${status}`
      throw new SwapAndBridgeProviderApiError(error)
    } finally {
      if (timeoutPromise) clearTimeout(timeoutPromise)
    }

    if (response.status === 429) {
      const error = `Our service provider received too many requests, temporarily preventing your request from being processed. ${errorPrefix}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    let responseBody: {
      result?: T
      statusCode?: number
      message?: { error?: string; details?: any } | string | null
      success?: boolean
    }
    try {
      responseBody = await response.json()
    } catch (e: any) {
      const message = e?.message || 'no message'
      const error = `${errorPrefix} Error details: <Unexpected non-JSON response from our service provider>, message: <${message}>`
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (!response.ok || responseBody?.success === false) {
      const responseMessage = responseBody?.message
      const genericErrorMessage =
        typeof responseMessage === 'string'
          ? responseMessage
          : responseMessage?.error || 'no message'
      const specificError =
        typeof responseMessage === 'string' ? undefined : responseMessage?.details?.error?.message
      const specificErrorMessage = specificError ? `, details: <${specificError}>` : ''
      const specificErrorCode =
        typeof responseMessage === 'string' ? undefined : responseMessage?.details?.error?.code
      const specificErrorCodeMessage = specificErrorCode ? `, code: <${specificErrorCode}>` : ''
      const error = `${errorPrefix} Our service provider upstream error: <${genericErrorMessage}>${specificErrorMessage}${specificErrorCodeMessage}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    // Always attempt to update health status (if needed) when a response was
    // successful, in case the API was previously unhealthy (to recover).
    // Do not wait on purpose, to not block or delay the response
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateHealthIfNeeded()

    return responseBody.result !== undefined ? responseBody.result : (responseBody as T)
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const url = `${this.#socketApiUrl}/v3/swap/supported-chains`

    const response = await this.#handleResponse<SocketAPISupportedChain[]>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix:
        'Unable to retrieve the list of supported Swap & Bridge chains from our service provider.'
    })

    const chains = response
      .filter((c) => c.sendingEnabled && c.receivingEnabled && c.chainId !== CITREA_CHAIN_ID)
      .map(({ chainId }) => ({
        chainId
      }))

    this.supportedChains = chains

    return chains
  }

  async getToTokenList({ toChainId }: { toChainId: number }): Promise<SwapAndBridgeToToken[]> {
    const params = new URLSearchParams({
      chainIds: toChainId.toString(),
      // The long list for some networks is HUGE (e.g. Ethereum has 10,000+ tokens),
      // which makes serialization and deserialization of this controller computationally expensive.
      list: 'trending'
    })
    const url = `${this.#socketApiUrl}/v3/swap/tokens/list?${params.toString()}`

    const response = await this.#handleResponse<{ [chainId: string]: SocketAPIToken[] }>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix:
        'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
    })

    let tokens = response[toChainId] || []

    // Exception for Optimism, strip out the legacy ETH address
    // TODO: Remove when Socket removes the legacy ETH address from their response
    if (toChainId === 10)
      tokens = tokens.filter(
        (token: SocketAPIToken) => token.address !== ETH_ON_OPTIMISM_LEGACY_ADDRESS
      )

    // Exception for Ethereum, duplicate ETH tokens are incoming from the API.
    // One is with the `ZERO_ADDRESS` and one with `NULL_ADDRESS`, both for ETH.
    // Strip out the one with the `ZERO_ADDRESS` to be consistent with the rest.
    if (toChainId === 1)
      tokens = tokens.filter((token: SocketAPIToken) => token.address !== zeroAddress)

    tokens = tokens.map(normalizeIncomingSocketToken)

    return addCustomTokensIfNeeded({ chainId: toChainId, tokens })
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null> {
    const params = new URLSearchParams({
      q: address.toString()
    })
    const url = `${this.#socketApiUrl}/v3/swap/tokens/search?${params.toString()}`

    const response = await this.#handleResponse<{
      tokens: { [chainId: string]: SocketAPIToken[] }
    }>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to retrieve token information by address.'
    })

    if (!response.tokens || !response.tokens[chainId] || !response.tokens[chainId].length)
      return null

    return normalizeIncomingSocketToken(response.tokens[chainId][0]!)
  }

  async quote({
    fromAsset,
    toAsset,
    fromChainId,
    fromTokenAddress,
    toChainId,
    toTokenAddress,
    fromAmount,
    userAddress,
    isWrapOrUnwrap,
    accountNativeBalance,
    nativeSymbol
  }: ProviderQuoteParams): Promise<SwapAndBridgeQuote> {
    if (!fromAsset || !toAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <from token details are missing>'
      )

    const params = new URLSearchParams({
      userOps: 'tx',
      userAddress,
      originChainId: fromChainId.toString(),
      destinationChainId: toChainId.toString(),
      inputToken: normalizeOutgoingSocketTokenAddress(fromTokenAddress),
      outputToken: normalizeOutgoingSocketTokenAddress(toTokenAddress),
      inputAmount: fromAmount.toString(),
      receiverAddress: userAddress
    })
    const feeTakerAddress = AMBIRE_FEE_TAKER_ADDRESSES[fromChainId]
    const shouldIncludeConvenienceFee =
      !!feeTakerAddress && !isWrapOrUnwrap && !isNoFeeToken(fromChainId, fromTokenAddress)
    if (shouldIncludeConvenienceFee) {
      params.append('feeTakerAddress', feeTakerAddress)
      params.append('feeBps', (FEE_PERCENT * 100).toString())
    }

    const url = `${this.#socketApiUrl}/v3/swap/quote?${params.toString()}`

    const response = await this.#handleResponse<SocketV3QuoteResponse>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to fetch the quote.'
    })

    const socketToAsset = response.routes[0]?.output.token || {
      ...toAsset,
      icon: toAsset.icon ?? '',
      logoURI: toAsset.icon ?? ''
    }
    const allRoutes = [...response.routes].sort((r1, r2) => {
      const a = BigInt(r1.output.amount)
      const b = BigInt(r2.output.amount)
      if (a === b) return 0
      if (a > b) return -1
      return 1
    })

    const routes = allRoutes.map((route) => {
      const protocol = getRouteProtocol(route)
      const nativeValue = getNativeValue(route)
      const hasNativeValueFee =
        nativeValue > 0n && normalizeOutgoingSocketTokenAddress(fromTokenAddress) !== ethAddress
      const serviceFee: SwapAndBridgeRoute['serviceFee'] = hasNativeValueFee
        ? {
            amount: nativeValue.toString(),
            amountUSD: route.gasFee?.feeInUsd?.toString() || ''
          }
        : undefined
      const disabled =
        serviceFee === undefined ? false : accountNativeBalance < BigInt(serviceFee.amount)
      const disabledReason = disabled
        ? `Insufficient ${nativeSymbol}. This bridge imposes a fee that must be paid in ${nativeSymbol}.`
        : undefined
      const normalizedToAsset = normalizeIncomingSocketToken(route.output.token)
      const outputValueAfterGasInUsd =
        route.gasFee?.feeInUsd === undefined
          ? route.output.valueInUsd
          : route.output.valueInUsd - Number(route.gasFee.feeInUsd)
      const steps: SwapAndBridgeRoute['steps'] = [
        {
          chainId: fromChainId,
          fromAmount: response.input.amount,
          fromAsset: { ...fromAsset, chainId: Number(fromAsset.chainId) },
          serviceTime: route.estimatedTime ?? 1,
          minAmountOut: route.output.minAmountOut,
          protocol: {
            name: protocol.name,
            displayName: protocol.displayName || protocol.name,
            icon: protocol.icon || ''
          },
          swapSlippage: route.slippage,
          toAmount: route.output.amount,
          toAsset: normalizedToAsset,
          type: 'swap' as const,
          userTxIndex: 0
        }
      ]
      const userTxs: SwapAndBridgeRoute['userTxs'] = steps.map((step) => ({
        ...step,
        chainId: step.chainId || fromChainId
      }))

      const swapAndBridgeRoute: SwapAndBridgeRoute = {
        ...steps[0]!,
        providerId: this.id,
        outputValueInUsd: route.output.valueInUsd,
        outputValueAfterGasInUsd,
        routeId: route.quoteId,
        disabled,
        disabledReason,
        steps,
        serviceFee,
        userTxs,
        userAddress,
        isOnlySwapRoute: fromChainId === normalizedToAsset.chainId,
        currentUserTxIndex: 0,
        serviceTime: route.estimatedTime ?? 1,
        fromChainId,
        toChainId: normalizedToAsset.chainId,
        inputValueInUsd: response.input.valueInUsd,
        toToken: {
          address: normalizedToAsset.address,
          chainId: normalizedToAsset.chainId,
          priceUSD: route.output.priceInUsd.toString(),
          symbol: normalizedToAsset.symbol,
          decimals: normalizedToAsset.decimals,
          name: normalizedToAsset.name,
          logoURI: normalizedToAsset.logoURI
        },
        approvalData: route.approval || undefined,
        txData: route.txData
          ? {
              chainId: route.txData.object.chainId || fromChainId,
              data: route.txData.object.data,
              to: route.txData.object.to,
              value: route.txData.object.value || '0'
            }
          : undefined,
        rawRoute: route as any,
        withConvenienceFee: shouldIncludeConvenienceFee,
        usedBridgeNames:
          fromChainId !== normalizedToAsset.chainId ? [protocol.name.toLowerCase()] : [''],
        usedDexName: fromChainId === normalizedToAsset.chainId ? protocol.displayName : undefined
      }

      return swapAndBridgeRoute
    })

    return {
      fromAsset: normalizeIncomingSocketToken(response.input.token),
      toAsset: normalizeIncomingSocketToken(socketToAsset),
      fromChainId,
      toChainId,
      selectedRoute: routes[0],
      selectedRouteSteps: routes[0]?.steps || [],
      routes
    }
  }

  async startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest> {
    if (!route) throw new Error('route not set')
    if (!route.txData) throw new Error('route tx data not set')

    return {
      activeRouteId: route.routeId,
      approvalData: route.approvalData
        ? {
            allowanceTarget: route.approvalData.spenderAddress,
            approvalTokenAddress: route.approvalData.tokenAddress,
            minimumApprovalAmount: route.approvalData.amount,
            owner: route.approvalData.userAddress
          }
        : null,
      chainId: route.fromChainId,
      txData: route.txData.data,
      txTarget: route.txData.to,
      userTxIndex: route.steps.length ? route.steps[0]!.userTxIndex : 0,
      value: route.txData.value
    }
  }

  async getRouteStatus({
    txHash,
    routeId
  }: {
    txHash: string
    routeId?: string
  }): Promise<SwapAndBridgeRouteStatusResult> {
    if (!routeId) return { status: null }

    const params = new URLSearchParams({
      quoteId: routeId
    })
    const url = `${this.#socketApiUrl}/v3/swap/status?${params.toString()}`

    const response = await this.#handleResponse<SocketV3StatusResponse>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
    })

    const status = (response.status || response.statusCode || '').toUpperCase()
    const statusCode = (response.statusCode || '').toUpperCase()
    if (status === 'COMPLETED' || statusCode === 'FULFILLED')
      return { status: 'completed', txnId: getStatusTxnId(response, txHash) }
    if (status === 'REFUNDED')
      return { status: 'refunded', txnId: getStatusTxnId(response, txHash) }
    if (status === 'FAILED' || status === 'EXPIRED') {
      return { status: 'failed', txnId: getStatusTxnId(response, txHash) }
    }

    return { status: null }
  }
}
