import { getAddress } from 'ethers'

import { ExtendedChain, LiFiStep, TokensResponse } from '@lifi/types'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { InviteController } from '../../controllers/invite/invite'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SocketAPIActiveRoutes,
  SocketAPIQuote,
  SocketAPIResponse,
  SocketAPISendTransactionRequest,
  SocketAPISupportedChain,
  SocketAPIToken,
  SocketRouteStatus
} from '../../interfaces/swapAndBridge'
import {
  AMBIRE_FEE_TAKER_ADDRESSES,
  AMBIRE_WALLET_TOKEN_ON_BASE,
  AMBIRE_WALLET_TOKEN_ON_ETHEREUM,
  ETH_ON_OPTIMISM_LEGACY_ADDRESS,
  FEE_PERCENT,
  NULL_ADDRESS,
  ZERO_ADDRESS
} from '../socket/constants'

const convertZeroAddressToNullAddressIfNeeded = (addr: string) =>
  addr === ZERO_ADDRESS ? NULL_ADDRESS : addr

const convertNullAddressToZeroAddressIfNeeded = (addr: string) =>
  addr === NULL_ADDRESS ? ZERO_ADDRESS : addr

const normalizeIncomingSocketTokenAddress = (address: string) =>
  // incoming token addresses from Socket are all lowercased
  getAddress(
    // native token addresses come as null address instead of the zero address
    convertNullAddressToZeroAddressIfNeeded(address)
  )
export const normalizeIncomingSocketToken = (token: SocketAPIToken) => ({
  ...token,
  address: normalizeIncomingSocketTokenAddress(token.address)
})

const normalizeOutgoingSocketTokenAddress = (address: string) =>
  // Socket expects to receive null address instead of the zero address for native tokens.
  convertZeroAddressToNullAddressIfNeeded(
    // Socket works only with all lowercased token addresses, otherwise, bad request
    address.toLocaleLowerCase()
  )
const normalizeOutgoingSocketToken = (token: SocketAPIToken) => ({
  ...token,
  address: normalizeOutgoingSocketTokenAddress(token.address)
})

export class LiFiAPI {
  #fetch: Fetch

  #baseUrl = 'https://li.quest/v1'

  #headers: RequestInitWithCustomHeaders['headers']

  isHealthy: boolean | null = null

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#fetch = fetch

    this.#headers = {
      // TODO: API does NOT require any authentication to be used (with lower limits)
      // 'x-lifi-api-key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }

  async getHealth() {
    // Li.Fi’s v1 API doesn't have a dedicated health endpoint
    return true

    try {
      const response = await this.#fetch(`${this.#baseUrl}/health`, { headers: this.#headers })
      if (!response.ok) return false

      const body = await response.json()
      return !!body.ok
    } catch {
      return false
    }
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

    try {
      response = await fetchPromise
    } catch (e: any) {
      const message = e?.message || 'no message'
      const status = e?.status ? `, status: <${e.status}>` : ''
      const error = `${errorPrefix} Upstream error: <${message}>${status}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (response.status === 429) {
      const error = `Our service provider received too many requests, temporarily preventing your request from being processed. ${errorPrefix}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    let responseBody: SocketAPIResponse<T>
    try {
      responseBody = await response.json()
    } catch (e: any) {
      const message = e?.message || 'no message'
      const error = `${errorPrefix} Error details: <Unexpected non-JSON response from our service provider>, message: <${message}>`
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (!response.ok) {
      // API returns 2 types of errors, a generic one, on the top level:
      const genericErrorMessage = responseBody?.message?.error || 'no message'
      // ... and a detailed one, nested in the `details` object:
      const specificError = responseBody?.message?.details?.error?.message
      const specificErrorMessage = specificError ? `, details: <${specificError}>` : ''
      const specificErrorCode = responseBody?.message?.details?.error?.code
      const specificErrorCodeMessage = specificErrorCode ? `, code: <${specificErrorCode}>` : ''
      const error = `${errorPrefix} Our service provider upstream error: <${genericErrorMessage}>${specificErrorMessage}${specificErrorCodeMessage}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    // Always attempt to update health status (if needed) when a response was
    // successful, in case the API was previously unhealthy (to recover).
    // Do not wait on purpose, to not block or delay the response
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // this.updateHealthIfNeeded()

    return responseBody
  }

  async getSupportedChains(): Promise<ExtendedChain[]> {
    const url = `${this.#baseUrl}/chains?chainTypes=EVM`

    const response = await this.#handleResponse<{ chains: ExtendedChain[] }>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix:
        'Unable to retrieve the list of supported Swap & Bridge chains from our service provider.'
    })

    return response.chains.map((c) => ({ ...c, chainId: c.id }))
  }

  /**
   * Since v4.41.0 we request the shortlist from Socket, which does not include
   * the Ambire $WALLET token. So adding it manually on the supported chains.
   */
  static addCustomTokens({ chainId, tokens }: { chainId: number; tokens: SocketAPIToken[] }) {
    const newTokens = [...tokens]

    if (chainId === 1) newTokens.unshift(AMBIRE_WALLET_TOKEN_ON_ETHEREUM)
    if (chainId === 8453) newTokens.unshift(AMBIRE_WALLET_TOKEN_ON_BASE)

    return newTokens
  }

  async getToTokenList({
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SocketAPIToken[]> {
    // TODO: Figure out a way to pull only a shortlist
    const params = new URLSearchParams({
      chains: toChainId.toString(),
      chainTypes: 'EVM'
    })
    const url = `${this.#baseUrl}/tokens?${params.toString()}`

    const response = await this.#handleResponse<TokensResponse>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix:
        'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
    })

    // Exception for Optimism, strip out the legacy ETH address
    // TODO: Remove when Socket removes the legacy ETH address from their response
    // if (toChainId === 10)
    //   response = response.filter(
    //     (token: SocketAPIToken) => token.address !== ETH_ON_OPTIMISM_LEGACY_ADDRESS
    //   )

    // Exception for Ethereum, duplicate ETH tokens are incoming from the API.
    // One is with the `ZERO_ADDRESS` and one with `NULL_ADDRESS`, both for ETH.
    // Strip out the one with the `ZERO_ADDRESS` to be consistent with the rest.
    // if (toChainId === 1)
    //   response = response.filter((token: SocketAPIToken) => token.address !== ZERO_ADDRESS)

    // TODO: Add custom tokens
    // response = SocketAPI.addCustomTokens({ chainId: toChainId, tokens: response })

    // TODO: Refine types
    return response.tokens[toChainId].map((t) => ({ ...t, icon: t.logoURI, symbol: t.coinKey }))
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<TokensResponse | null> {
    const params = new URLSearchParams({
      token: address.toString(),
      chain: chainId.toString()
    })
    const url = `${this.#baseUrl}/token`

    const response = await this.#handleResponse<TokensResponse>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to retrieve token information by address.'
    })

    if (!response) return null

    return response
  }

  async quote({
    fromChainId,
    fromTokenAddress,
    toChainId,
    toTokenAddress,
    fromAmount,
    userAddress,
    isSmartAccount,
    sort,
    isOG
  }: {
    fromChainId: number
    fromTokenAddress: string
    toChainId: number
    toTokenAddress: string
    fromAmount: bigint
    userAddress: string
    isSmartAccount: boolean
    sort: 'time' | 'output'
    isOG: InviteController['isOG']
  }): Promise<SocketAPIQuote> {
    const body = JSON.stringify({
      fromChainId: fromChainId.toString(),
      fromAmount: fromAmount.toString(),
      fromTokenAddress,
      toChainId: toChainId.toString(),
      toTokenAddress,
      fromAddress: userAddress,
      toAddress: userAddress,
      options: {
        slippage: '1',
        order: sort === 'time' ? 'FASTEST' : 'CHEAPEST',
        allowDestinationCall: 'false'
      }
    })

    // TODO: Wire-up convenience fee
    // const feeTakerAddress = AMBIRE_FEE_TAKER_ADDRESSES[fromChainId]
    // const shouldIncludeConvenienceFee = !!feeTakerAddress && !isOG
    // if (shouldIncludeConvenienceFee) {
    //   params.append('feeTakerAddress', feeTakerAddress)
    //   params.append('feePercent', FEE_PERCENT.toString())
    // }

    const url = `${this.#baseUrl}/advanced/routes`

    const response = await this.#handleResponse<LiFiStep>({
      fetchPromise: this.#fetch(url, { headers: this.#headers, method: 'POST', body }),
      errorPrefix: 'Unable to fetch the quote.'
    })

    return {
      ...response,
      fromAsset: response.routes[0].fromToken,
      fromChainId: response.routes[0].fromChainId,
      toAsset: response.routes[0].toToken,
      toChainId: response.routes[0].toChainId,
      selectedRoute: response.routes[0],
      selectedRouteSteps: response.routes[0].steps,
      // TODO: Monkey-patched the response temporarily
      routes: response.routes.map((route) => ({
        ...route,
        fromAsset: route.fromToken,
        toAsset: {
          ...route.toToken,
          toAmount: route.toAmount
        },
        steps: route.steps.map((step) => ({
          ...step,
          ...step.action,
          fromAsset: route.fromToken,
          toAsset: {
            ...route.toToken,
            toAmount: route.toAmount
          },
          toAmount: route.toAmount
        }))
      }))
    }
  }

  async startRoute({
    fromChainId,
    toChainId,
    fromAssetAddress,
    toAssetAddress,
    route
  }: {
    fromChainId: number
    toChainId: number
    fromAssetAddress: string
    toAssetAddress: string
    // TODO: Refine types
    route: SocketAPIQuote['selectedRoute']
  }) {
    const body = JSON.stringify(route.steps[0])

    const response = await this.#handleResponse<SocketAPISendTransactionRequest>({
      fetchPromise: this.#fetch(`${this.#baseUrl}/advanced/stepTransaction`, {
        method: 'POST',
        headers: this.#headers,
        body
      }),
      errorPrefix: 'Unable to start the route.'
    })

    return response
  }

  async getRouteStatus({
    activeRouteId,
    userTxIndex,
    txHash
  }: {
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
    userTxIndex: SocketAPISendTransactionRequest['userTxIndex']
    txHash: string
  }) {
    const params = new URLSearchParams({
      activeRouteId: activeRouteId.toString(),
      userTxIndex: userTxIndex.toString(),
      txHash
    })
    const url = `${this.#baseUrl}/route/prepare?${params.toString()}`

    const response = await this.#handleResponse<SocketRouteStatus>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
    })

    return response
  }

  async updateActiveRoute(
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
  ): Promise<SocketAPIActiveRoutes> {
    const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() })
    const url = `${this.#baseUrl}/route/active-routes?${params.toString()}`

    const response = await this.#handleResponse<SocketAPIActiveRoutes>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to update the active route.'
    })

    return {
      ...response,
      fromAsset: normalizeIncomingSocketToken(response.fromAsset),
      fromAssetAddress: normalizeIncomingSocketTokenAddress(response.fromAssetAddress),
      toAsset: normalizeIncomingSocketToken(response.toAsset),
      toAssetAddress: normalizeIncomingSocketTokenAddress(response.toAssetAddress),
      userTxs: (response.userTxs as SocketAPIActiveRoutes['userTxs']).map((userTx) => ({
        ...userTx,
        ...('fromAsset' in userTx && { fromAsset: normalizeIncomingSocketToken(userTx.fromAsset) }),
        toAsset: normalizeIncomingSocketToken(userTx.toAsset),
        ...('steps' in userTx && {
          steps: userTx.steps.map((step) => ({
            ...step,
            fromAsset: normalizeIncomingSocketToken(step.fromAsset),
            toAsset: normalizeIncomingSocketToken(step.toAsset)
          }))
        })
      }))
    }
  }

  async getNextRouteUserTx(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() })
    const url = `${this.#baseUrl}/route/build-next-tx?${params.toString()}`

    const response = await this.#handleResponse<SocketAPISendTransactionRequest>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to start the next step.'
    })

    return response
  }
}
