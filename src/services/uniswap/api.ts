import { formatUnits, getAddress, Interface, ZeroAddress } from 'ethers'

import { CITREA_CHAIN_ID } from '@/consts/networks'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { getTokenUsdAmount } from '../../controllers/signAccountOp/helper'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  ProviderQuoteParams,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatusResult,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeStep,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapAndBridgeUserTx,
  SwapProvider,
  UniswapApprovalResponse,
  UniswapQuote,
  UniswapQuoteResponse,
  UniswapStatusResponse,
  UniswapSwapResponse,
  UniswapTransactionRequest
} from '../../interfaces/swapAndBridge'
import {
  addCustomTokensIfNeeded,
  convertPortfolioTokenToSwapAndBridgeToToken,
  getSlippage,
  isNoFeeToken,
  sortNativeTokenFirst
} from '../../libs/swapAndBridge/swapAndBridge'
import { AcrossAPI } from '../across/api'
import {
  AMBIRE_FEE_TAKER_ADDRESS,
  FEE_PERCENT,
  STABLE_TOKEN_SYMBOLS,
  SWAP_COMPATIBLE_ROUTINGS,
  UNISWAP_API_BASE_URL,
  UNISWAP_SUPPORTED_CHAIN_IDS
} from './constants'

const erc20Interface = new Interface(ERC20.abi)

const isAcrossBridgeQuote = (quote: UniswapQuote) =>
  quote.exclusiveRelayer !== undefined &&
  quote.exclusivityDeadline !== undefined &&
  quote.fillDeadline !== undefined

const normalizeAddress = (address: string) =>
  address.toLowerCase() === ZeroAddress.toLowerCase() ? ZeroAddress : getAddress(address)

const getUniswapProtocol = (routing: string) => ({
  name: routing === 'BRIDGE' ? 'Uniswap Bridge' : 'Uniswap',
  displayName: routing === 'BRIDGE' ? 'Uniswap Bridge' : 'Uniswap',
  icon: ''
})

const getMinAmountOut = (quote: UniswapQuote, userAddress: string) => {
  const userOutput = quote.aggregatedOutputs?.find(
    (output) =>
      output.recipient.toLowerCase() === userAddress.toLowerCase() &&
      normalizeAddress(output.token) === normalizeAddress(quote.output.token)
  )

  return userOutput?.minAmount || quote.output.amount
}

const getUserOutputAmount = (quote: UniswapQuote, userAddress: string) => {
  const userOutput = quote.aggregatedOutputs?.find(
    (output) =>
      output.recipient.toLowerCase() === userAddress.toLowerCase() &&
      normalizeAddress(output.token) === normalizeAddress(quote.output.token)
  )

  return userOutput?.amount || quote.output.amount
}

const getUsdPriceFromAsset = (asset: SwapAndBridgeToToken) => {
  const priceUSD = Number((asset as any).priceUSD || 0)
  if (priceUSD > 0) return priceUSD

  const priceInUsd = (asset as any).priceIn?.find?.(
    (price: { baseCurrency?: string }) => price.baseCurrency === 'usd'
  )?.price
  if (Number(priceInUsd) > 0) return Number(priceInUsd)

  if (STABLE_TOKEN_SYMBOLS.has(asset.symbol.toUpperCase())) return 1

  return 0
}

const getOutputValueInUsd = ({
  inputValueInUsd,
  quote,
  toAsset,
  toAmount,
  userAddress
}: {
  inputValueInUsd: number
  quote: UniswapQuote
  toAsset: SwapAndBridgeToToken
  toAmount: string
  userAddress: string
}) => {
  const toTokenPriceUSD = getUsdPriceFromAsset(toAsset)
  if (toTokenPriceUSD) {
    return {
      outputValueInUsd: Number(formatUnits(toAmount, toAsset.decimals)) * toTokenPriceUSD,
      toTokenPriceUSD
    }
  }

  if (!inputValueInUsd) {
    return {
      outputValueInUsd: 0,
      toTokenPriceUSD: 0
    }
  }

  const userOutputBps =
    quote.aggregatedOutputs?.find(
      (output) =>
        output.recipient.toLowerCase() === userAddress.toLowerCase() &&
        normalizeAddress(output.token) === normalizeAddress(quote.output.token)
    )?.bps || 10000
  const priceImpactMultiplier = Math.max(0, 1 - (quote.priceImpact || 0) / 100)

  return {
    outputValueInUsd: inputValueInUsd * (userOutputBps / 10000) * priceImpactMultiplier,
    toTokenPriceUSD: 0
  }
}

const normalizeUniswapRouteToSwapAndBridgeRoute = ({
  response,
  fromAsset,
  originalFromAsset,
  toAsset,
  fromChainId,
  toChainId,
  userAddress,
  withConvenienceFee
}: {
  response: UniswapQuoteResponse
  fromAsset: SwapAndBridgeToToken
  originalFromAsset: ProviderQuoteParams['fromAsset']
  toAsset: SwapAndBridgeToToken
  fromChainId: number
  toChainId: number
  userAddress: string
  withConvenienceFee: boolean
}): SwapAndBridgeRoute => {
  const quote = response.quote
  const fromAmount = quote.input.amount
  const toAmount = getUserOutputAmount(quote, userAddress)
  const serviceTime = quote.estimatedFillTimeMs ? Math.ceil(quote.estimatedFillTimeMs / 1000) : 0
  const protocol = getUniswapProtocol(response.routing)
  const minAmountOut = getMinAmountOut(quote, userAddress)
  const inputValueInUsd = originalFromAsset
    ? Number(getTokenUsdAmount(originalFromAsset, BigInt(fromAmount)) || 0)
    : 0
  const { outputValueInUsd, toTokenPriceUSD } = getOutputValueInUsd({
    inputValueInUsd,
    quote,
    toAsset,
    toAmount,
    userAddress
  })

  const userTx: SwapAndBridgeUserTx = {
    userTxIndex: 0,
    fromAsset,
    toAsset,
    chainId: fromChainId,
    fromAmount,
    toAmount,
    swapSlippage: quote.slippage,
    serviceTime,
    protocol,
    minAmountOut
  }

  const step: SwapAndBridgeStep = {
    ...userTx,
    type: 'swap'
  }

  return {
    providerId: 'uniswap',
    routeId: quote.quoteId || response.requestId,
    fromChainId,
    toChainId,
    userAddress,
    isOnlySwapRoute: fromChainId === toChainId,
    fromAmount,
    toAmount,
    currentUserTxIndex: 0,
    ...(fromChainId === toChainId
      ? { usedDexName: 'Uniswap' }
      : { usedBridgeNames: [isAcrossBridgeQuote(quote) ? 'across' : 'uniswap'] }),
    userTxs: [userTx],
    steps: [step],
    inputValueInUsd,
    outputValueInUsd,
    outputValueAfterGasInUsd:
      quote.gasFeeUSD === undefined ? undefined : outputValueInUsd - Number(quote.gasFeeUSD),
    serviceTime,
    rawRoute: response,
    sender: userAddress,
    toToken: {
      address: toAsset.address,
      chainId: toAsset.chainId,
      decimals: toAsset.decimals,
      logoURI: toAsset.icon || '',
      name: toAsset.name,
      priceUSD: toTokenPriceUSD ? toTokenPriceUSD.toString() : undefined,
      symbol: toAsset.symbol
    } as any,
    disabled: false,
    withConvenienceFee
  }
}

const parseApprovalSpender = (approval: UniswapTransactionRequest | null, fallback: string) => {
  if (!approval?.data) return fallback

  try {
    const decoded = erc20Interface.decodeFunctionData('approve', approval.data)
    return getAddress(decoded[0])
  } catch (e) {
    return fallback
  }
}

export class UniswapAPI implements SwapProvider {
  id: string = 'uniswap'

  name: string = 'Uniswap'

  #fetch: Fetch

  #acrossAPI: AcrossAPI

  #headers: RequestInitWithCustomHeaders['headers']

  #requestTimeoutMs = 15000

  isHealthy: boolean | null = null

  supportedChains: SwapProvider['supportedChains'] = null

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#fetch = fetch
    this.#acrossAPI = new AcrossAPI({ fetch })
    this.#headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-permit2-disabled': 'true'
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async getHealth() {
    return true
  }

  async updateHealth() {
    this.isHealthy = await this.getHealth()
  }

  resetHealth() {
    this.isHealthy = null
  }

  #ensureApiKey() {
    if (this.#headers['x-api-key']) return

    throw new SwapAndBridgeProviderApiError(
      'Our service provider Uniswap is not configured yet. Error details: <missing UNISWAP_API_KEY>'
    )
  }

  areChainsSupported({ fromChainId, toChainId }: { fromChainId: number; toChainId: number }) {
    if (fromChainId === Number(CITREA_CHAIN_ID) || toChainId === Number(CITREA_CHAIN_ID))
      return false

    return (
      UNISWAP_SUPPORTED_CHAIN_IDS.includes(fromChainId) &&
      UNISWAP_SUPPORTED_CHAIN_IDS.includes(toChainId)
    )
  }

  async #handleResponse<T>({
    fetchPromise,
    errorPrefix
  }: {
    fetchPromise: Promise<CustomResponse>
    errorPrefix: string
  }): Promise<T> {
    this.#ensureApiKey()

    let response: CustomResponse

    try {
      let timeoutPromise: NodeJS.Timeout | undefined
      response = await Promise.race([
        fetchPromise,
        new Promise<CustomResponse>((_, reject) => {
          timeoutPromise = setTimeout(() => {
            reject(
              new SwapAndBridgeProviderApiError(
                'Our service provider Uniswap is temporarily unavailable or your internet connection is too slow.'
              )
            )
          }, this.#requestTimeoutMs)
        })
      ])

      if (timeoutPromise) clearTimeout(timeoutPromise)
    } catch (e: any) {
      if (e instanceof SwapAndBridgeProviderApiError) throw e

      const message = e?.message || 'no message'
      const status = e?.status ? `, status: <${e.status}>` : ''
      const error = `${errorPrefix} Our service provider Uniswap could not be reached: <${message}>${status}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (response.status === 429) {
      throw new SwapAndBridgeProviderApiError(
        `Our service provider Uniswap received too many requests, temporarily preventing your request from being processed. ${errorPrefix}`
      )
    }

    let responseBody: T
    try {
      responseBody = await response.json()
    } catch (e: any) {
      const message = e?.message || 'no message'
      const error = `${errorPrefix} Error details: <Unexpected non-JSON response from our service provider Uniswap>, message: <${message}>`
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (!response.ok) {
      const upstreamBody = responseBody as any
      const upstreamMessage =
        upstreamBody?.detail ||
        upstreamBody?.message ||
        upstreamBody?.error ||
        upstreamBody?.errors?.[0]?.message ||
        JSON.stringify(upstreamBody).slice(0, 250)
      const error = `${errorPrefix} Our service provider Uniswap responded: <${upstreamMessage}>`
      throw new SwapAndBridgeProviderApiError(error)
    }

    return responseBody
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const chains = UNISWAP_SUPPORTED_CHAIN_IDS.filter(
      (chainId) => chainId !== Number(CITREA_CHAIN_ID)
    ).map((chainId) => ({ chainId }))

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
        'The requested network pair is not supported by our service provider Uniswap.'
      )
    }

    return sortNativeTokenFirst(addCustomTokensIfNeeded({ chainId: toChainId, tokens: [] }))
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null> {
    const normalizedAddress = normalizeAddress(address)
    const customToken = addCustomTokensIfNeeded({ chainId, tokens: [] }).find(
      (token) => normalizeAddress(token.address) === normalizedAddress
    )

    return customToken || null
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
    this.#ensureApiKey()

    if (!this.areChainsSupported({ fromChainId, toChainId }))
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but Uniswap does not support this chain pair.'
      )
    if (!fromAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <from token details are missing>'
      )
    if (!toAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <to token details are missing>'
      )

    const shouldIncludeConvenienceFee =
      !isWrapOrUnwrap && !isNoFeeToken(fromChainId, fromTokenAddress)

    const body: {
      type: 'EXACT_INPUT'
      amount: string
      tokenInChainId: number
      tokenOutChainId: number
      tokenIn: string
      tokenOut: string
      swapper: string
      recipient: string
      slippageTolerance: number
      routingPreference: 'BEST_PRICE'
      protocols?: ('V2' | 'V3' | 'V4')[]
      permitAmount: 'EXACT'
      integratorFees?: { bips: number; recipient: string }[]
    } = {
      type: 'EXACT_INPUT',
      amount: fromAmount.toString(),
      tokenInChainId: fromChainId,
      tokenOutChainId: toChainId,
      tokenIn: normalizeAddress(fromTokenAddress),
      tokenOut: normalizeAddress(toTokenAddress),
      swapper: userAddress,
      recipient: userAddress,
      slippageTolerance: Number(getSlippage(fromAsset, fromAmount, '0.5', 0.5)),
      routingPreference: 'BEST_PRICE',
      permitAmount: 'EXACT'
    }

    if (fromChainId === toChainId) body.protocols = ['V4', 'V3', 'V2']
    if (shouldIncludeConvenienceFee) {
      body.integratorFees = [
        {
          bips: FEE_PERCENT * 100,
          recipient: AMBIRE_FEE_TAKER_ADDRESS
        }
      ]
    }

    const response = await this.#handleResponse<UniswapQuoteResponse>({
      fetchPromise: this.#fetch(`${UNISWAP_API_BASE_URL}/quote`, {
        method: 'POST',
        headers: this.#headers,
        body: JSON.stringify(body)
      }),
      errorPrefix: 'Unable to fetch the quote.'
    })

    if (!SWAP_COMPATIBLE_ROUTINGS.includes(response.routing)) {
      throw new SwapAndBridgeProviderApiError(
        `Unable to fetch the quote. Uniswap returned an unsupported routing type: <${response.routing}>`
      )
    }

    const normalizedFromAsset = convertPortfolioTokenToSwapAndBridgeToToken(fromAsset, fromChainId)

    return {
      fromAsset: normalizedFromAsset,
      fromChainId,
      toAsset,
      toChainId,
      routes: [
        normalizeUniswapRouteToSwapAndBridgeRoute({
          response,
          fromAsset: normalizedFromAsset,
          originalFromAsset: fromAsset,
          fromChainId,
          toAsset,
          toChainId,
          userAddress,
          withConvenienceFee: shouldIncludeConvenienceFee
        })
      ],
      selectedRoute: undefined,
      selectedRouteSteps: []
    }
  }

  async #checkApproval(route: SwapAndBridgeRoute) {
    const fromToken = route.steps[0]?.fromAsset.address
    if (!fromToken || fromToken === ZeroAddress) return null
    this.#ensureApiKey()

    const response = await this.#handleResponse<UniswapApprovalResponse>({
      fetchPromise: this.#fetch(`${UNISWAP_API_BASE_URL}/check_approval`, {
        method: 'POST',
        headers: this.#headers,
        body: JSON.stringify({
          walletAddress: route.userAddress,
          token: normalizeAddress(fromToken),
          amount: route.fromAmount,
          chainId: route.fromChainId,
          tokenOut: normalizeAddress(route.steps[0]!.toAsset.address),
          tokenOutChainId: route.toChainId
        })
      }),
      errorPrefix: 'Unable to check token approval.'
    })

    return response.approval
  }

  async startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest> {
    this.#ensureApiKey()

    const rawRoute = route.rawRoute as UniswapQuoteResponse
    const approval = await this.#checkApproval(route)
    const response = await this.#handleResponse<UniswapSwapResponse>({
      fetchPromise: this.#fetch(`${UNISWAP_API_BASE_URL}/swap`, {
        method: 'POST',
        headers: this.#headers,
        body: JSON.stringify({
          quote: rawRoute.quote,
          refreshGasPrice: true,
          simulateTransaction: false,
          safetyMode: 'SAFE'
        })
      }),
      errorPrefix: 'Unable to start the route.'
    })

    if (
      !response.swap ||
      typeof response.swap.data !== 'string' ||
      typeof response.swap.to !== 'string' ||
      typeof response.swap.value !== 'string'
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the route. Error details: <missing transaction request data>'
      )
    }

    const fromToken = route.steps[0]?.fromAsset.address

    return {
      activeRouteId: route.routeId,
      approvalData:
        !approval || !fromToken || fromToken === ZeroAddress
          ? null
          : {
              allowanceTarget: parseApprovalSpender(approval, response.swap.to),
              approvalTokenAddress: fromToken,
              minimumApprovalAmount: route.fromAmount,
              owner: route.userAddress
            },
      chainId: route.fromChainId,
      txTarget: response.swap.to,
      userTxIndex: 0,
      value: response.swap.value,
      txData: response.swap.data
    }
  }

  async getRouteStatus({
    txHash,
    fromChainId,
    toChainId,
    bridge
  }: {
    txHash: string
    fromChainId: number
    toChainId: number
    bridge?: string
  }): Promise<SwapAndBridgeRouteStatusResult> {
    if (fromChainId === toChainId) return { status: 'completed', txnId: txHash }
    if (bridge === 'across') return this.#acrossAPI.getRouteStatus({ txHash })

    this.#ensureApiKey()

    const params = new URLSearchParams({
      txHashes: txHash,
      chainId: fromChainId.toString()
    })

    const response = await this.#handleResponse<UniswapStatusResponse>({
      fetchPromise: this.#fetch(`${UNISWAP_API_BASE_URL}/swaps?${params.toString()}`, {
        headers: this.#headers
      }),
      errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
    })

    const status = response.swaps[0]?.status
    const txnId = response.swaps[0]?.txHash || null
    if (status === 'SUCCESS') return { status: 'completed', txnId }
    if (status === 'FAILED' || status === 'EXPIRED') return { status: 'refunded', txnId }

    return { status: null }
  }
}
