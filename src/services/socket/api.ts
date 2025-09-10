import { getAddress } from 'ethers'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  BungeeBuildTxnResponse,
  BungeeExchangeQuoteResponse,
  BungeeRouteStatus,
  SocketAPIResponse,
  SocketAPISupportedChain,
  SocketAPIToken,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import { TokenResult } from '../../libs/portfolio'
import {
  addCustomTokensIfNeeded,
  convertNullAddressToZeroAddressIfNeeded
} from '../../libs/swapAndBridge/swapAndBridge'
import {
  AMBIRE_FEE_TAKER_ADDRESSES,
  ETH_ON_OPTIMISM_LEGACY_ADDRESS,
  FEE_PERCENT,
  NULL_ADDRESS,
  PROTOCOLS_WITH_CONTRACT_FEE_IN_NATIVE,
  ZERO_ADDRESS
} from './constants'

const convertZeroAddressToNullAddressIfNeeded = (addr: string) =>
  addr === ZERO_ADDRESS ? NULL_ADDRESS : addr

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

export class SocketAPI implements SwapProvider {
  id: string = 'socket'

  #fetch: Fetch

  #baseUrl = 'https://api.socket.tech/v2'

  // https://public-backend.bungee.exchange
  // #bungeQuoteApiUrl = 'https://dedicated-backend.bungee.exchange'
  #bungeQuoteApiUrl = 'https://dedicated-backend.bungee.exchange'

  #headers: RequestInitWithCustomHeaders['headers']

  isHealthy: boolean | null = null

  constructor({ fetch }: { fetch: Fetch }) {
    this.#fetch = fetch

    this.#headers = {
      'API-KEY': process.env.SOCKET_API_KEY!,
      'x-api-key': process.env.BUNGEE_API_KEY!,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }

  async getHealth() {
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

    // Socket API returns 500 status code with a message in the body, even
    // in case of a bad request. Not necessarily an internal server error.
    if (!response.ok || !responseBody?.success) {
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
    this.updateHealthIfNeeded()

    return responseBody.result
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const url = `${this.#baseUrl}/supported/chains`

    const response = await this.#handleResponse<SocketAPISupportedChain[]>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix:
        'Unable to retrieve the list of supported Swap & Bridge chains from our service provider.'
    })

    return response
      .filter((c) => c.sendingEnabled && c.receivingEnabled)
      .map(({ chainId }) => ({
        chainId
      }))
  }

  async getToTokenList({
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SwapAndBridgeToToken[]> {
    const params = new URLSearchParams({
      fromChainId: fromChainId.toString(),
      toChainId: toChainId.toString(),
      // The long list for some networks is HUGE (e.g. Ethereum has 10,000+ tokens),
      // which makes serialization and deserialization of this controller computationally expensive.
      isShortList: 'true'
    })
    const url = `${this.#baseUrl}/token-lists/to-token-list?${params.toString()}`

    let response = await this.#handleResponse<SocketAPIToken[]>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix:
        'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
    })

    // Exception for Optimism, strip out the legacy ETH address
    // TODO: Remove when Socket removes the legacy ETH address from their response
    if (toChainId === 10)
      response = response.filter(
        (token: SocketAPIToken) => token.address !== ETH_ON_OPTIMISM_LEGACY_ADDRESS
      )

    // Exception for Ethereum, duplicate ETH tokens are incoming from the API.
    // One is with the `ZERO_ADDRESS` and one with `NULL_ADDRESS`, both for ETH.
    // Strip out the one with the `ZERO_ADDRESS` to be consistent with the rest.
    if (toChainId === 1)
      response = response.filter((token: SocketAPIToken) => token.address !== ZERO_ADDRESS)

    response = response.map(normalizeIncomingSocketToken)

    return addCustomTokensIfNeeded({ chainId: toChainId, tokens: response })
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null> {
    const params = new URLSearchParams({
      address: address.toString(),
      chainId: chainId.toString()
    })
    const url = `${this.#baseUrl}/supported/token-support?${params.toString()}`

    const response = await this.#handleResponse<{ isSupported: boolean; token: SocketAPIToken }>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to retrieve token information by address.'
    })

    if (!response.isSupported || !response.token) return null

    return normalizeIncomingSocketToken(response.token)
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
    isOG,
    accountNativeBalance,
    nativeSymbol
  }: {
    fromAsset: TokenResult | null
    toAsset: SwapAndBridgeToToken | null
    fromChainId: number
    fromTokenAddress: string
    toChainId: number
    toTokenAddress: string
    fromAmount: bigint
    userAddress: string
    sort: 'time' | 'output'
    isOG: boolean
    accountNativeBalance: bigint
    nativeSymbol: string
  }): Promise<SwapAndBridgeQuote> {
    if (!fromAsset || !toAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <from token details are missing>'
      )

    const params = new URLSearchParams({
      userAddress,
      originChainId: fromChainId.toString(),
      destinationChainId: toChainId.toString(),
      inputToken: normalizeOutgoingSocketTokenAddress(fromTokenAddress),
      outputToken: normalizeOutgoingSocketTokenAddress(toTokenAddress),
      inputAmount: fromAmount.toString(),
      receiverAddress: userAddress,
      useInbox: 'true',
      enableManual: 'true'
    })
    const feeTakerAddress = AMBIRE_FEE_TAKER_ADDRESSES[fromChainId]
    const shouldIncludeConvenienceFee = !!feeTakerAddress && !isOG
    if (shouldIncludeConvenienceFee) {
      params.append('feeTakerAddress', feeTakerAddress)
      params.append('feeBps', (FEE_PERCENT * 100).toString())
    }

    const url = `${this.#bungeQuoteApiUrl}/api/v1/bungee/quote?${params.toString()}`

    const response: BungeeExchangeQuoteResponse =
      await this.#handleResponse<BungeeExchangeQuoteResponse>({
        fetchPromise: this.#fetch(url, { headers: this.#headers }),
        errorPrefix: 'Unable to fetch the quote.'
      })

    // configure the toAsset
    let socketToAsset = response.autoRoute ? response.autoRoute.output.token : null
    if (!socketToAsset) {
      socketToAsset = response.manualRoutes.length ? response.manualRoutes[0].output.token : null
    }
    if (!socketToAsset) {
      socketToAsset = { ...toAsset, icon: toAsset.icon ?? '', logoURI: '' }
    }

    let allRoutes = [...response.manualRoutes]
    if (response.autoRoute) allRoutes.push(response.autoRoute)
    allRoutes = allRoutes.sort((r1, r2) => {
      const a = BigInt(r1.output.amount)
      const b = BigInt(r2.output.amount)
      if (a === b) return 0
      if (a > b) return -1
      return 1
    })
    return {
      fromAsset: normalizeIncomingSocketToken(response.input.token),
      toAsset: normalizeIncomingSocketToken(socketToAsset),
      fromChainId: response.input.token.chainId,
      toChainId: response.manualRoutes.length ? response.manualRoutes[0].output.token.chainId : 0,
      // @ts-ignore TODO: fix the typescript here
      routes: allRoutes.map((route) => {
        const steps = [
          {
            chainId: route.output.token.chainId,
            fromAmount: fromAmount.toString(),
            fromAsset: { ...fromAsset, chainId: Number(fromAsset.chainId) },
            serviceTime: route.estimatedTime ?? 1,
            minAmountOut: route.output.minAmountOut,
            protocol: {
              name: route.routeDetails.name,
              displayName: route.routeDetails.name,
              icon: route.routeDetails.logoURI
            },
            protocolFees:
              PROTOCOLS_WITH_CONTRACT_FEE_IN_NATIVE.includes(route.routeDetails.name) &&
              route.routeDetails.routeFee &&
              route.routeDetails.routeFee.amount !== '0'
                ? {
                    amount: route.routeDetails.routeFee.amount,
                    asset: route.routeDetails.routeFee.token,
                    feesInUsd: route.routeDetails.routeFee.feeInUsd
                  }
                : undefined,
            swapSlippage: route.slippage,
            toAmount: route.output.amount,
            toAsset: route.output.token,
            type: 'swap',
            userTxIndex: 0
          }
        ]

        // set the service fee
        const serviceFee: SwapAndBridgeRoute['serviceFee'] = steps[0].protocolFees
          ? {
              amount: steps[0].protocolFees.amount,
              amountUSD: steps[0].protocolFees.feesInUsd.toString()
            }
          : undefined

        // disable routes the user does not have native to pay for
        const disabled =
          serviceFee === undefined ? false : accountNativeBalance < BigInt(serviceFee.amount)
        const disabledReason = disabled
          ? `Insufficient ${nativeSymbol}. This bridge imposes a fee that must be paid in ${nativeSymbol}.`
          : undefined

        return {
          ...steps[0],
          providerId: 'socket',
          outputValueInUsd: route.output.valueInUsd,
          routeId: route.quoteId,
          disabled,
          disabledReason,
          steps,
          serviceFee,
          userTxs: steps,
          userAddress,
          isOnlySwapRoute: fromChainId === route.output.token.chainId,
          currentUserTxIndex: 0,
          fromChainId,
          toChainId: route.output.token.chainId,
          inputValueInUsd: response.input.valueInUsd,
          toToken: {
            priceUSD: route.output.priceInUsd,
            symbol: route.output.token.symbol,
            decimals: route.output.token.decimals,
            name: route.output.token.name,
            logoURI: route.output.token.logoURI
          },
          approvalData: 'approvalData' in route ? route.approvalData : undefined,
          txData: 'txData' in route ? route.txData : undefined,
          rawRoute: '' // not needed for socket
        }
      })
    }
  }

  async startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest> {
    if (!route) throw new Error('route not set')

    // the socket auto route return a txData object so we already have it
    if (route.txData) {
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
        userTxIndex: route.steps.length ? route.steps[0].userTxIndex : 0,
        value: route.txData.value
      }
    }

    const response = await this.#handleResponse<BungeeBuildTxnResponse>({
      fetchPromise: this.#fetch(
        `${this.#bungeQuoteApiUrl}/api/v1/bungee/build-tx?quoteId=${route.routeId}`,
        {
          method: 'GET',
          headers: this.#headers
        }
      ),
      errorPrefix: 'Unable to start the route.'
    })

    return {
      activeRouteId: route.routeId,
      approvalData: response.approvalData
        ? {
            allowanceTarget: response.approvalData.spenderAddress,
            approvalTokenAddress: response.approvalData.tokenAddress,
            minimumApprovalAmount: response.approvalData.amount,
            owner: response.approvalData.userAddress
          }
        : null,
      chainId: route.fromChainId,
      txData: response.txData.data,
      txTarget: response.txData.to,
      userTxIndex: 0,
      value: response.txData.value
    }
  }

  async getRouteStatus({ txHash }: { txHash: string }) {
    const params = new URLSearchParams({
      txHash
    })
    const url = `${this.#bungeQuoteApiUrl}/api/v1/bungee/status?${params.toString()}`

    const response = await this.#handleResponse<BungeeRouteStatus[] | null>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
    })

    if (!response) return null
    const res = response[0]
    // everything below 3 is pending on our end
    if (res.bungeeStatusCode < 3) return null
    // 3 and 4 is completed on our end
    if (res.bungeeStatusCode < 5) return 'completed'
    // everything after is refunded
    return 'refunded'
  }
}
