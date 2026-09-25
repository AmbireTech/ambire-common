import { getAddress, isAddress } from 'ethers'

import SwapAndBridgeProviderApiError from '@/classes/SwapAndBridgeProviderApiError'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '@/interfaces/fetch'
import {
  CowSwapOrderCreation,
  CowSwapQuoteResponse,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken
} from '@/interfaces/swapAndBridge'
import { addCustomTokensIfNeeded } from '@/libs/swapAndBridge/swapAndBridge'
import {
  computeOrderUid,
  getApiNetwork,
  isCowSwapTokenListEntry,
  normalizeCowSwapToken
} from '@/services/cowswap/helper'
import {
  CenaPlatformResponse,
  CenaTokenResponse,
  CowSwapErrorResponse,
  CowSwapOrderResponse,
  CowSwapTokenListEntry,
  CowSwapTrade
} from '@/services/cowswap/types'

import {
  CENA_API_BASE_URL,
  COWSWAP_API_BASE_URL,
  COWSWAP_SUPPORTED_CHAINS,
  COWSWAP_TOKEN_LIST_URL
} from './constants'

/** Shared, protocol-level CoW HTTP client used by market swaps and limit orders. */
export class CowSwapClient {
  #fetch: Fetch

  #headers: RequestInitWithCustomHeaders['headers'] = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  #apiHeaders: RequestInitWithCustomHeaders['headers']

  #requestTimeoutMs = 15000

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#fetch = fetch
    this.#apiHeaders = { ...this.#headers, 'X-API-Key': apiKey }
  }

  getApiUrl(chainId: number, path: string, version: 'v1' | 'v2' = 'v1') {
    const apiNetwork = getApiNetwork(chainId)
    if (!apiNetwork) {
      throw new SwapAndBridgeProviderApiError(
        'The requested network is not supported by our service provider CoW Swap.'
      )
    }

    return `${COWSWAP_API_BASE_URL}/${apiNetwork}/api/${version}${path}`
  }

  async fetchWithTimeout(url: string, init?: RequestInitWithCustomHeaders) {
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

  async parseResponse<T>(response: CustomResponse, errorPrefix: string): Promise<T> {
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

  getSupportedChains(): SwapAndBridgeSupportedChain[] {
    return COWSWAP_SUPPORTED_CHAINS.map(({ chainId }) => ({ chainId }))
  }

  async #getTokenList(): Promise<CowSwapTokenListEntry[]> {
    const response = await this.parseResponse<{ tokens?: unknown }>(
      await this.fetchWithTimeout(COWSWAP_TOKEN_LIST_URL, { headers: this.#headers }),
      'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
    )

    if (!Array.isArray(response.tokens)) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to retrieve the list of supported receive tokens. CoW Swap returned an unexpected token list.'
      )
    }

    return response.tokens.filter(isCowSwapTokenListEntry)
  }

  async getToTokenList(chainId: number): Promise<SwapAndBridgeToToken[]> {
    const tokens = (await this.#getTokenList())
      .filter((token) => token.chainId === chainId)
      .map(normalizeCowSwapToken)

    return addCustomTokensIfNeeded({ chainId, tokens })
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

    const nativePriceResponse = await this.fetchWithTimeout(
      this.getApiUrl(chainId, `/token/${normalizedAddress}/native_price`),
      { headers: this.#apiHeaders }
    )
    if (nativePriceResponse.status === 404) return null
    await this.parseResponse(nativePriceResponse, 'Unable to check whether the token is supported.')

    const platformResponse = await this.fetchWithTimeout(
      `${CENA_API_BASE_URL}/api/v3/platform/${chainId}`,
      { headers: this.#headers }
    )
    if (platformResponse.status === 404) return null
    const { platformId } = await this.parseResponse<CenaPlatformResponse>(
      platformResponse,
      'Unable to retrieve token information by address.'
    )
    if (typeof platformId !== 'string' || !platformId) return null

    const tokenResponse = await this.fetchWithTimeout(
      `${CENA_API_BASE_URL}/api/v3/coins/${encodeURIComponent(
        platformId
      )}/contract/${normalizedAddress}`,
      { headers: this.#headers }
    )
    if (tokenResponse.status === 404) return null
    const token = await this.parseResponse<CenaTokenResponse>(
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

  async getQuote(chainId: number, request: Record<string, unknown>): Promise<CowSwapQuoteResponse> {
    const response = await this.fetchWithTimeout(this.getApiUrl(chainId, '/quote'), {
      method: 'POST',
      headers: this.#apiHeaders,
      body: JSON.stringify(request)
    })

    return this.parseResponse<CowSwapQuoteResponse>(response, 'Unable to fetch the quote.')
  }

  async getOrder(chainId: number, orderUid: string): Promise<CowSwapOrderResponse | null> {
    const response = await this.fetchWithTimeout(this.getApiUrl(chainId, `/orders/${orderUid}`), {
      headers: this.#apiHeaders
    })
    if (response.status === 404) return null

    return this.parseResponse<CowSwapOrderResponse>(response, 'Unable to check the CoW Swap order.')
  }

  async uploadAppData(chainId: number, appDataHash: string, fullAppData: string) {
    const response = await this.fetchWithTimeout(
      this.getApiUrl(chainId, `/app_data/${appDataHash}`),
      {
        method: 'PUT',
        headers: this.#apiHeaders,
        body: JSON.stringify({ fullAppData })
      }
    )

    await this.parseResponse(response, 'Unable to prepare the CoW Swap order.')
  }

  async submitOrder({
    chainId,
    order,
    orderUid
  }: {
    chainId: number
    order: CowSwapOrderCreation
    orderUid: string
  }) {
    let computedOrderUid: string
    try {
      computedOrderUid = computeOrderUid({
        chainId,
        order,
        owner: order.from,
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

    const response = await this.fetchWithTimeout(this.getApiUrl(chainId, '/orders'), {
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
    if (errorBody.errorType === 'InsufficientAllowance') return false

    const message =
      errorBody.description || errorBody.message || errorBody.errorType || 'Unknown error'
    throw new SwapAndBridgeProviderApiError(
      `Unable to submit the CoW Swap order. CoW Swap responded: <${message}>`
    )
  }

  async getSettlementTransaction(chainId: number, orderUid: string) {
    const params = new URLSearchParams({ orderUid, limit: '10' })
    const response = await this.fetchWithTimeout(
      this.getApiUrl(chainId, `/trades?${params.toString()}`, 'v2'),
      { headers: this.#apiHeaders }
    )
    const trades = await this.parseResponse<CowSwapTrade[]>(
      response,
      'Unable to retrieve the completed CoW Swap transaction.'
    )

    return trades.find((trade) => trade.txHash)?.txHash || null
  }
}
