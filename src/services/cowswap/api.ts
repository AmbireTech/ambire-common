import { getAddress, isAddress, keccak256, toUtf8Bytes, ZeroAddress } from 'ethers'

import {
  buildAppData,
  buildLimitOrderAppData,
  computeOrderUid,
  ethFlowInterface,
  getApiNetwork,
  getCowSwapOrderStruct,
  getNetworkCostSlippageBps,
  getOutputValueInUsd,
  getPriceSlippageBps,
  getProtocolFeeAmount,
  getWrappedNativeTokenAddress,
  isAmbireLimitOrderAppData,
  isCowSwapAccountOrder,
  isCowSwapTokenListEntry,
  normalizeBuyTokenAddress,
  normalizeCowSwapToken,
  parseSmartSlippageBps,
  settlementInterface
} from '@/services/cowswap/helper'
import {
  CowSwapAccountOrder,
  CowSwapErrorResponse,
  CowSwapOrderResponse,
  CowSwapTokenListEntry,
  CowSwapTrade
} from '@/services/cowswap/types'

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
import { getFeeExemptionReason } from '../../libs/swapAndBridge/fee'
import {
  addCustomTokensIfNeeded,
  convertPortfolioTokenToSwapAndBridgeToToken,
  getSlippage,
  isNoFeeToken
} from '../../libs/swapAndBridge/swapAndBridge'
import {
  COWSWAP_ACCOUNT_ORDERS_PAGE_SIZE,
  COWSWAP_API_BASE_URL,
  COWSWAP_BFF_BASE_URL,
  COWSWAP_BUY_NATIVE_TOKEN_ADDRESS,
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_ORDER_VALIDITY_SECONDS,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_SMART_SLIPPAGE_CACHE_MS,
  COWSWAP_SMART_SLIPPAGE_FAILURE_CACHE_MS,
  COWSWAP_SMART_SLIPPAGE_TIMEOUT_MS,
  COWSWAP_SUPPORTED_CHAINS,
  COWSWAP_TOKEN_LIST_CACHE_MS,
  COWSWAP_TOKEN_LIST_URL,
  COWSWAP_VAULT_RELAYER_ADDRESS
} from './constants'

export class CowSwapAPI implements SwapProvider {
  id = 'cowswap'

  name = 'CoW Swap'

  #fetch: Fetch

  #headers: RequestInitWithCustomHeaders['headers'] = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  #apiHeaders: RequestInitWithCustomHeaders['headers']

  #requestTimeoutMs = 15000

  /** The last successfully fetched token list, kept in memory only */
  #tokenListCache: { fetchedAt: number; tokens: CowSwapTokenListEntry[] } | null = null

  /** The token list request in progress, so that simultaneous callers share one request */
  #tokenListRequest: Promise<CowSwapTokenListEntry[]> | null = null

  /**
   * The smart slippage of recently quoted token pairs, kept in memory only. A request in
   * progress is kept too, so that simultaneous quotes for a pair share it, and so is a failure,
   * so that a failing endpoint doesn't slow down every quote
   */
  #smartSlippageCache = new Map<
    string,
    { expiresAt: number; slippageBps: Promise<number | null> }
  >()

  isHealthy: boolean | null = null

  supportedChains: SwapProvider['supportedChains'] = null

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#fetch = fetch
    this.#apiHeaders = { ...this.#headers, 'X-API-Key': apiKey }
  }

  async updateHealth() {
    this.isHealthy = true
  }

  resetHealth() {
    this.isHealthy = null
  }

  areChainsSupported({ fromChainId, toChainId }: { fromChainId: number; toChainId: number }) {
    // CoW Swap orders settle on a single network, so a different destination chain would
    // silently turn into a swap for the destination token address on the source chain
    return fromChainId === toChainId && !!getApiNetwork(fromChainId)
  }

  #getApiUrl(chainId: number, path: string, version: 'v1' | 'v2' = 'v1') {
    const apiNetwork = getApiNetwork(chainId)
    if (!apiNetwork) {
      throw new SwapAndBridgeProviderApiError(
        'The requested network is not supported by our service provider CoW Swap.'
      )
    }

    return `${COWSWAP_API_BASE_URL}/${apiNetwork}/api/${version}${path}`
  }

  /** Rejects with a "temporarily unavailable" error if `promise` doesn't settle in `timeoutMs` */
  async #withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout | undefined

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new SwapAndBridgeProviderApiError(
                'Our service provider CoW Swap is temporarily unavailable or your internet connection is too slow.'
              )
            )
          }, timeoutMs)
        })
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  /** Times out the response headers only; reading the body is up to the caller */
  async #fetchWithTimeout(
    url: string,
    init?: RequestInitWithCustomHeaders,
    timeoutMs = this.#requestTimeoutMs
  ) {
    try {
      return await this.#withTimeout(this.#fetch(url, init), timeoutMs)
    } catch (error: any) {
      if (error instanceof SwapAndBridgeProviderApiError) throw error

      const message = error?.message || 'no message'
      throw new SwapAndBridgeProviderApiError(
        `Our service provider CoW Swap could not be reached. Error details: <${message}>`
      )
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

  /** Never throws, so that a failure to get the smart slippage never fails the quote */
  async #fetchSmartSlippageBps(
    url: string
  ): Promise<{ slippageBps: number | null; hasFailed: boolean }> {
    try {
      // The timeout covers reading the body too, so that a stalled body can't hold the request
      const body = await this.#withTimeout(
        this.#fetch(url, { headers: this.#headers }).then((response) =>
          this.#parseResponse<unknown>(response, 'Unable to fetch the recommended slippage.')
        ),
        COWSWAP_SMART_SLIPPAGE_TIMEOUT_MS
      )
      return { slippageBps: parseSmartSlippageBps(body), hasFailed: false }
    } catch (error: unknown) {
      // The smart slippage only improves the order, so the quote falls back to the fixed one
      console.warn('CoW Swap: unable to fetch the smart slippage, using the fixed one', error)
      return { slippageBps: null, hasFailed: true }
    }
  }

  /**
   * The slippage CoW Swap recommends for selling `sellToken` for `buyToken`, based on how
   * volatile the pair is. Null if CoW Swap has no recommendation or it couldn't be fetched
   */
  async #getSmartSlippageBps({
    chainId,
    sellToken,
    buyToken
  }: {
    chainId: number
    sellToken: string
    buyToken: string
  }): Promise<number | null> {
    // CoW Swap has market data for the wrapped native token only
    const marketBuyToken =
      buyToken.toLowerCase() === COWSWAP_BUY_NATIVE_TOKEN_ADDRESS.toLowerCase()
        ? getWrappedNativeTokenAddress(chainId) || buyToken
        : buyToken
    const cacheKey = `${chainId}:${sellToken.toLowerCase()}-${marketBuyToken.toLowerCase()}`

    // Drop the expired pairs, so that the cache doesn't grow while the wallet stays open
    const now = Date.now()
    this.#smartSlippageCache.forEach((entry, key) => {
      if (entry.expiresAt <= now) this.#smartSlippageCache.delete(key)
    })

    const cached = this.#smartSlippageCache.get(cacheKey)
    if (cached) return cached.slippageBps

    const request = this.#fetchSmartSlippageBps(
      `${COWSWAP_BFF_BASE_URL}/${chainId}/markets/${sellToken}-${marketBuyToken}/slippageTolerance`
    )
    // The request in progress doesn't expire. It always settles, because both the request
    // and reading its body time out
    const entry = {
      expiresAt: Infinity,
      slippageBps: request.then(({ slippageBps }) => slippageBps)
    }
    this.#smartSlippageCache.set(cacheKey, entry)

    const { slippageBps, hasFailed } = await request
    entry.expiresAt =
      Date.now() +
      (hasFailed ? COWSWAP_SMART_SLIPPAGE_FAILURE_CACHE_MS : COWSWAP_SMART_SLIPPAGE_CACHE_MS)

    return slippageBps
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const chains = COWSWAP_SUPPORTED_CHAINS.map(({ chainId }) => ({ chainId }))
    this.supportedChains = chains
    return chains
  }

  async #getTokenList(): Promise<CowSwapTokenListEntry[]> {
    if (
      this.#tokenListCache &&
      Date.now() - this.#tokenListCache.fetchedAt < COWSWAP_TOKEN_LIST_CACHE_MS
    )
      return this.#tokenListCache.tokens

    if (!this.#tokenListRequest) {
      // Failed requests are not cached, the next call tries again
      this.#tokenListRequest = this.#fetchTokenList()
        .then((tokens) => {
          this.#tokenListCache = { fetchedAt: Date.now(), tokens }
          return tokens
        })
        .finally(() => {
          this.#tokenListRequest = null
        })
    }

    return this.#tokenListRequest
  }

  async #fetchTokenList(): Promise<CowSwapTokenListEntry[]> {
    const response = await this.#parseResponse<{ tokens?: unknown }>(
      await this.#fetchWithTimeout(COWSWAP_TOKEN_LIST_URL, { headers: this.#headers }),
      'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
    )

    if (!Array.isArray(response.tokens)) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to retrieve the list of supported receive tokens. CoW Swap returned an unexpected token list.'
      )
    }

    return response.tokens.filter(isCowSwapTokenListEntry)
  }

  async getToTokenList({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SwapAndBridgeToToken[]> {
    const tokens = (await this.#getTokenList())
      .filter((token) => token.chainId === toChainId)
      .map(normalizeCowSwapToken)

    return addCustomTokensIfNeeded({ chainId: toChainId, tokens })
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null> {
    if (!getApiNetwork(chainId) || !isAddress(address)) return null

    const normalizedAddress = getAddress(address)
    const listedToken = (await this.#getTokenList()).find(
      (token) =>
        token.chainId === chainId && token.address.toLowerCase() === normalizedAddress.toLowerCase()
    )
    if (listedToken) return normalizeCowSwapToken(listedToken)

    // The data of tokens missing from the CoW Swap token list is not available here. For the
    // ones that CoW Swap can trade (see `isTokenSupported`), the swap controller reads it from
    // the chain
    return null
  }

  /**
   * Whether CoW Swap can trade the token, even if the token is missing from the CoW Swap token
   * list. CoW Swap can trade a token only if it can price it.
   */
  async isTokenSupported({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<boolean> {
    if (!getApiNetwork(chainId) || !isAddress(address)) return false

    const nativePriceResponse = await this.#fetchWithTimeout(
      this.#getApiUrl(chainId, `/token/${getAddress(address)}/native_price`),
      { headers: this.#apiHeaders }
    )
    if (nativePriceResponse.status === 404) return false
    await this.#parseResponse(
      nativePriceResponse,
      'Unable to check whether the token is supported.'
    )

    return true
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
    feePercent
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
    const fixedSlippageBps = Math.round(
      Number(getSlippage(fromAsset, fromAmount, '0.5', 0.5)) * 100
    )
    // The slippage doesn't change the quote, so CoW Swap's recommendation is fetched while
    // quoting, and the order gets its final slippage once the network cost is known
    const smartSlippageRequest = this.#getSmartSlippageBps({
      chainId: fromChainId,
      sellToken,
      buyToken
    })
    const feeExemptionReason = getFeeExemptionReason({
      isWrapOrUnwrap,
      isFeeExemptToken: isNoFeeToken(fromChainId, sellToken)
    })
    const shouldIncludeConvenienceFee = feePercent > 0 && !feeExemptionReason
    const feeBps = shouldIncludeConvenienceFee ? Math.round(feePercent * 100) : undefined
    const quoteAppData = buildAppData({ slippageBps: fixedSlippageBps, feeBps })
    const quoteRequest = {
      sellToken,
      buyToken,
      receiver: owner,
      from: owner,
      sellAmountBeforeFee: fromAmount.toString(),
      kind: 'sell',
      validFor: COWSWAP_ORDER_VALIDITY_SECONDS,
      appData: quoteAppData.fullAppData,
      appDataHash: quoteAppData.appDataHash,
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
      headers: this.#apiHeaders,
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
      returnedAppDataHash?.toLowerCase() !== quoteAppData.appDataHash.toLowerCase() ||
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
    const partnerFee = feeBps ? (buyAmountBeforeFees * BigInt(feeBps)) / 10000n : 0n
    // What the user actually receives: CoW Swap deducts the settlement network cost
    // from the output instead of charging gas separately
    const toAmountAfterNetworkCost = quotedBuyAmount - partnerFee
    // Other providers quote their output before gas and charge gas separately, so the
    // displayed toAmount adds the network cost back to compare all quotes the same way
    const toAmount = toAmountAfterNetworkCost + networkFeeInBuyToken
    // Covers both the price moving and the network cost growing before the order settles,
    // the same way CoW Swap's own SDK does
    const slippageBps =
      getPriceSlippageBps({
        smartSlippageBps: await smartSlippageRequest,
        fixedSlippageBps,
        fromAmountInUsd: Number(getTokenUsdAmount(fromAsset, fromAmount) || 0)
      }) + getNetworkCostSlippageBps({ networkFee, sellAmountAfterNetworkCost: quotedSellAmount })
    // The order carries its final slippage. The quote stays valid, because the AppData of the
    // order differs from the quoted one only in the slippage, which doesn't affect the price
    const { fullAppData, appDataHash } = buildAppData({ slippageBps, feeBps })
    // Must be derived from the amount after the network cost, otherwise the order asks
    // for more than solvers can deliver and it would never be filled
    const minAmountOut =
      toAmountAfterNetworkCost - (toAmountAfterNetworkCost * BigInt(slippageBps)) / 10000n

    if (toAmountAfterNetworkCost <= 0n || minAmountOut <= 0n) {
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
    const serviceTime = 10
    const inputValueInUsd = Number(getTokenUsdAmount(fromAsset, sellAmount) || 0)
    const outputValueInUsd = getOutputValueInUsd({
      inputValueInUsd,
      toAsset,
      toAmount: toAmount.toString(),
      buyAmountBeforeFees
    })
    const outputValueAfterNetworkCostInUsd = getOutputValueInUsd({
      inputValueInUsd,
      toAsset,
      toAmount: toAmountAfterNetworkCost.toString(),
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
      // The settlement network cost is what CoW Swap charges instead of gas, so the route
      // sorting compares the amount after it against other providers' after-gas values.
      // The gas of the user's own setPreSignature / ETH-flow createOrder tx is not included
      outputValueAfterGasInUsd: outputValueAfterNetworkCostInUsd,
      networkFeeInToToken: networkFeeInBuyToken.toString(),
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
      withConvenienceFee: shouldIncludeConvenienceFee,
      feeExemptionReason,
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
      txData: settlementInterface.encodeFunctionData('setPreSignature', [route.routeId, true]),
      cowSwapOrder: getCowSwapOrderStruct(rawRoute.order)
    }
  }

  async #getOrder(chainId: number, orderUid: string): Promise<CowSwapOrderResponse | null> {
    const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, `/orders/${orderUid}`), {
      headers: this.#apiHeaders
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
        headers: this.#apiHeaders,
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
      headers: this.#apiHeaders,
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
    const params = new URLSearchParams({ orderUid, limit: '10' })
    const response = await this.#fetchWithTimeout(
      this.#getApiUrl(chainId, `/trades?${params.toString()}`, 'v2'),
      { headers: this.#apiHeaders }
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

  /**
   * Today's market for selling `sellAmount` of `sellToken` for `buyToken`, the reference of a
   * limit order. `sellToken` is the zero address for the native token, which is sold through
   * the ETH-flow contract. Returns:
   * - `buyAmountBeforeFees` - what the sell amount is worth at the market price, before any fee.
   *   The price the user sets is compared to this one, as it's the price the order fills at
   * - `buyAmount` - what the user gets after the network cost and the fees
   * - `networkFee` (in the sell token) and `protocolFeeBps` - the costs CoW Swap takes, for
   *   working out what a limit order gets at another price
   */
  async getLimitOrderMarketQuote({
    chainId,
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    sellAmount,
    owner: ownerAddress,
    feeBps
  }: {
    chainId: number
    sellToken: string
    buyToken: string
    sellAmount: bigint
    owner: string
    feeBps?: number
  }): Promise<{
    buyAmount: bigint
    buyAmountBeforeFees: bigint
    networkFee: bigint
    protocolFeeBps: number
    quoteId: number | null
  }> {
    if (sellAmount <= 0n) {
      throw new SwapAndBridgeProviderApiError('Unable to fetch the price. Enter an amount first.')
    }
    const isEthFlow = sellTokenAddress.toLowerCase() === ZeroAddress.toLowerCase()
    const wrappedNativeTokenAddress = getWrappedNativeTokenAddress(chainId)
    if (isEthFlow && !wrappedNativeTokenAddress) {
      throw new SwapAndBridgeProviderApiError(
        'CoW Swap cannot sell the network native token on this network.'
      )
    }

    const sellToken = getAddress(isEthFlow ? wrappedNativeTokenAddress! : sellTokenAddress)
    const buyToken = normalizeBuyTokenAddress(buyTokenAddress)
    const owner = getAddress(ownerAddress)
    const { fullAppData, appDataHash } = buildLimitOrderAppData({ feeBps })
    const quoteRequest = {
      sellToken,
      buyToken,
      receiver: owner,
      from: owner,
      sellAmountBeforeFee: sellAmount.toString(),
      kind: 'sell',
      validFor: COWSWAP_ORDER_VALIDITY_SECONDS,
      appData: fullAppData,
      appDataHash,
      priceQuality: 'optimal',
      signingScheme: isEthFlow ? 'eip1271' : 'presign',
      ...(isEthFlow ? { onchainOrder: true, verificationGasLimit: 0 } : {})
    }
    const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, '/quote'), {
      method: 'POST',
      headers: this.#apiHeaders,
      body: JSON.stringify(quoteRequest)
    })
    const quoteResponse = await this.#parseResponse<CowSwapQuoteResponse>(
      response,
      'Unable to fetch the price.'
    )
    const quotedOrder = quoteResponse.quote
    if (
      !quotedOrder ||
      typeof quotedOrder.sellToken !== 'string' ||
      typeof quotedOrder.buyToken !== 'string' ||
      typeof quotedOrder.sellAmount !== 'string' ||
      typeof quotedOrder.buyAmount !== 'string' ||
      typeof quotedOrder.feeAmount !== 'string' ||
      quotedOrder.sellToken.toLowerCase() !== sellToken.toLowerCase() ||
      quotedOrder.buyToken.toLowerCase() !== buyToken.toLowerCase() ||
      quotedOrder.kind !== 'sell'
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the price. CoW Swap returned details that do not match your request.'
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
        'Unable to fetch the price. CoW Swap returned invalid token amounts.'
      )
    }
    if (quotedSellAmount + networkFee !== sellAmount || quotedSellAmount <= 0n) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the price. CoW Swap returned an unexpected spend amount.'
      )
    }

    const protocolFeeBps = Number(quoteResponse.protocolFeeBps || 0)
    if (!Number.isFinite(protocolFeeBps) || protocolFeeBps < 0) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the price. CoW Swap returned an invalid fee.'
      )
    }

    // Same math as the swap quote: CoW Swap quotes the output after its network cost and
    // protocol fee, while the Ambire fee is a share of the output before both
    const networkFeeInBuyToken = (quotedBuyAmount * networkFee) / quotedSellAmount
    const protocolFee = getProtocolFeeAmount(quotedBuyAmount, protocolFeeBps)
    const buyAmountBeforeFees = quotedBuyAmount + networkFeeInBuyToken + protocolFee
    const partnerFee = feeBps ? (buyAmountBeforeFees * BigInt(feeBps)) / 10000n : 0n
    const buyAmount = quotedBuyAmount - partnerFee

    if (buyAmount <= 0n) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the price. The amount you would receive is too low.'
      )
    }

    const quoteId =
      Number.isSafeInteger(quoteResponse.id) && Number(quoteResponse.id) >= 0
        ? Number(quoteResponse.id)
        : null

    return {
      buyAmount,
      buyAmountBeforeFees,
      networkFee,
      protocolFeeBps,
      quoteId
    }
  }

  /**
   * Sends a limit order to CoW Swap before the transaction that activates it. A pre-sign order
   * waits inactive until the transaction pre-signs it. An ETH-flow order is created by its
   * transaction, so only its app data is sent, for CoW Swap to know the Ambire fee
   */
  async submitLimitOrder({
    chainId,
    order,
    orderUid,
    isEthFlow
  }: {
    chainId: number
    order: CowSwapOrderCreation
    orderUid: string
    isEthFlow: boolean
  }): Promise<void> {
    let computedOrderUid: string
    try {
      computedOrderUid = computeOrderUid({ chainId, order, owner: order.from, isEthFlow })
    } catch {
      throw new SwapAndBridgeProviderApiError(
        'Unable to place the order because its details are invalid.'
      )
    }
    if (computedOrderUid !== orderUid) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to place the order because its details changed.'
      )
    }
    if (keccak256(toUtf8Bytes(order.appData)).toLowerCase() !== order.appDataHash.toLowerCase()) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to place the order because its details are invalid.'
      )
    }

    if (isEthFlow) {
      await this.#uploadAppData(chainId, order.appDataHash, order.appData)
      return
    }

    const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, '/orders'), {
      method: 'POST',
      headers: this.#apiHeaders,
      body: JSON.stringify(order)
    })

    let body: string | CowSwapErrorResponse
    try {
      body = await response.json()
    } catch (error: any) {
      const message = error?.message || 'no message'
      throw new SwapAndBridgeProviderApiError(
        `Unable to place the order. CoW Swap returned an unexpected response. Error details: <${message}>`
      )
    }

    if (response.ok) {
      if (body !== orderUid) {
        throw new SwapAndBridgeProviderApiError(
          'Unable to place the order because CoW Swap returned a different order.'
        )
      }
      return
    }

    const errorBody = body as CowSwapErrorResponse
    if (errorBody.errorType === 'DuplicatedOrder') return

    const message =
      errorBody.description || errorBody.message || errorBody.errorType || 'Unknown error'
    throw new SwapAndBridgeProviderApiError(
      `Unable to place the order. CoW Swap responded: <${message}>`
    )
  }

  /**
   * The limit orders `owner` placed from Ambire on `chainId`, newest first. Orders placed from
   * other apps and Ambire swaps, which are CoW Swap orders too, are left out
   */
  async getAccountLimitOrders({
    chainId,
    owner
  }: {
    chainId: number
    owner: string
  }): Promise<CowSwapAccountOrder[]> {
    const params = new URLSearchParams({
      offset: '0',
      limit: COWSWAP_ACCOUNT_ORDERS_PAGE_SIZE.toString()
    })
    const response = await this.#fetchWithTimeout(
      this.#getApiUrl(chainId, `/account/${getAddress(owner)}/orders?${params.toString()}`),
      { headers: this.#apiHeaders }
    )
    const orders = await this.#parseResponse<unknown>(response, 'Unable to load your orders.')
    if (!Array.isArray(orders)) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to load your orders. CoW Swap returned an unexpected response.'
      )
    }

    return orders.filter(
      (order): order is CowSwapAccountOrder =>
        isCowSwapAccountOrder(order) && isAmbireLimitOrderAppData(order.fullAppData)
    )
  }
}
