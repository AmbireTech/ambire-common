import { getAddress, isAddress, keccak256, toUtf8Bytes, ZeroAddress } from 'ethers'

import {
  buildAppData,
  computeOrderUid,
  ethFlowInterface,
  getApiNetwork,
  getOutputValueInUsd,
  getProtocolFeeAmount,
  getWrappedNativeTokenAddress,
  isCowSwapTokenListEntry,
  normalizeBuyTokenAddress,
  normalizeCowSwapToken,
  settlementInterface
} from '@/services/cowswap/helper'
import {
  CenaPlatformResponse,
  CenaTokenResponse,
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
  CENA_API_BASE_URL,
  COWSWAP_API_BASE_URL,
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_ORDER_VALIDITY_SECONDS,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_SUPPORTED_CHAINS,
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
    return !!getApiNetwork(fromChainId) && !!getApiNetwork(toChainId)
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

  async #getTokenList(): Promise<CowSwapTokenListEntry[]> {
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

    const nativePriceResponse = await this.#fetchWithTimeout(
      this.#getApiUrl(chainId, `/token/${normalizedAddress}/native_price`),
      { headers: this.#apiHeaders }
    )
    if (nativePriceResponse.status === 404) return null
    await this.#parseResponse(
      nativePriceResponse,
      'Unable to check whether the token is supported.'
    )

    const platformResponse = await this.#fetchWithTimeout(
      `${CENA_API_BASE_URL}/api/v3/platform/${chainId}`,
      { headers: this.#headers }
    )
    if (platformResponse.status === 404) return null
    const { platformId } = await this.#parseResponse<CenaPlatformResponse>(
      platformResponse,
      'Unable to retrieve token information by address.'
    )
    if (typeof platformId !== 'string' || !platformId) return null

    const tokenResponse = await this.#fetchWithTimeout(
      `${CENA_API_BASE_URL}/api/v3/coins/${encodeURIComponent(
        platformId
      )}/contract/${normalizedAddress}`,
      { headers: this.#headers }
    )
    if (tokenResponse.status === 404) return null
    const token = await this.#parseResponse<CenaTokenResponse>(
      tokenResponse,
      'Unable to retrieve token information by address.'
    )
    const platformAddress = token.platforms?.[platformId]
    const decimals = token.decimals?.[platformId]

    if (
      token.blacklist ||
      token.removed ||
      !platformAddress ||
      !isAddress(platformAddress) ||
      platformAddress.toLowerCase() !== normalizedAddress.toLowerCase() ||
      !Number.isInteger(decimals) ||
      decimals === undefined ||
      decimals < 0 ||
      decimals > 255 ||
      typeof token.name !== 'string' ||
      !token.name ||
      typeof token.symbol !== 'string' ||
      !token.symbol
    )
      return null

    return {
      address: normalizedAddress,
      chainId,
      decimals,
      icon: token.image?.large || token.image?.small || token.image?.thumb || '',
      name: token.name,
      symbol: token.symbol
    }
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
    const slippageBps = Math.round(Number(getSlippage(fromAsset, fromAmount, '0.5', 0.5)) * 100)
    const feeExemptionReason = getFeeExemptionReason({
      isWrapOrUnwrap,
      isFeeExemptToken: isNoFeeToken(fromChainId, sellToken)
    })
    const shouldIncludeConvenienceFee = feePercent > 0 && !feeExemptionReason
    const feeBps = shouldIncludeConvenienceFee ? Math.round(feePercent * 100) : undefined
    const { fullAppData, appDataHash } = buildAppData({ slippageBps, feeBps })
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
    const partnerFee = feeBps ? (buyAmountBeforeFees * BigInt(feeBps)) / 10000n : 0n
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
    const serviceTime = 10
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
      txData: settlementInterface.encodeFunctionData('setPreSignature', [route.routeId, true])
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
}
