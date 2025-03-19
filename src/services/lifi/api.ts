import { getAddress } from 'ethers'

import {
  ExtendedChain,
  LiFiStep,
  Route as LiFiRoute,
  RoutesResponse as LiFiRoutesResponse,
  Step as LiFiIncludedStep,
  Token as LiFiToken,
  TokensResponse as LiFiTokensResponse
} from '@lifi/types'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { InviteController } from '../../controllers/invite/invite'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SocketAPIActiveRoutes,
  SocketAPIQuote,
  SocketAPIResponse,
  SocketAPISendTransactionRequest,
  SocketAPIToken,
  SocketRouteStatus,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeStep,
  SwapAndBridgeToToken,
  SwapAndBridgeUserTx
} from '../../interfaces/swapAndBridge'
import { TokenResult } from '../../libs/portfolio'
import {
  addCustomTokensIfNeeded,
  convertPortfolioTokenToSwapAndBridgeToToken
} from '../../libs/swapAndBridge/swapAndBridge'
import { NULL_ADDRESS, ZERO_ADDRESS } from '../socket/constants'

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

const normalizeLiFiTokenToSwapAndBridgeToToken = (
  token: LiFiToken,
  toChainId: number
): SwapAndBridgeToToken => {
  const { name, address, decimals, symbol, logoURI: icon } = token

  return { name, address, decimals, symbol, icon, chainId: toChainId }
}

const normalizeLiFiStepToSwapAndBridgeStep = (parentStep: LiFiStep): SwapAndBridgeStep[] =>
  parentStep.includedSteps.map((step: LiFiIncludedStep, index: number) => ({
    chainId: step.action.fromChainId,
    fromAmount: step.action.fromAmount,
    fromAsset: normalizeLiFiTokenToSwapAndBridgeToToken(
      step.action.fromToken,
      step.action.fromChainId
    ),
    gasFees: {
      gasAmount: step.estimate.gasCosts?.[0]?.amount || '',
      gasLimit: +(step.estimate.gasCosts?.[0]?.limit || 0),
      feesInUsd: +(step.estimate.gasCosts?.[0]?.amountUSD || 0),
      asset: step.estimate.gasCosts?.[0]?.token
        ? normalizeLiFiTokenToSwapAndBridgeToToken(
            step.estimate.gasCosts[0].token,
            step.estimate.gasCosts[0].token.chainId
          )
        : undefined
    },
    minAmountOut: step.estimate.toAmountMin,
    protocol: {
      name: step.toolDetails.name,
      displayName: step.toolDetails.name,
      icon: step.toolDetails.logoURI
    },
    swapSlippage: step.action.slippage,
    toAmount: step.estimate.toAmount,
    toAsset: normalizeLiFiTokenToSwapAndBridgeToToken(step.action.toToken, step.action.toChainId),
    type: step.type === 'swap' ? 'swap' : 'middleware',
    userTxIndex: index
  }))

const normalizeLiFiStepToSwapAndBridgeUserTx = (parentStep: LiFiStep): SwapAndBridgeUserTx[] =>
  parentStep.includedSteps.map((step: LiFiIncludedStep, index: number) => ({
    // TODO: Check if correct
    userTxType: step.type === 'swap' ? 'dex-swap' : 'fund-movr',
    userTxIndex: index,
    // TODO: Check if correct
    txType: step.type === 'swap' ? 'dex-swap' : 'fund-movr',
    fromAsset: normalizeLiFiTokenToSwapAndBridgeToToken(
      step.action.fromToken,
      step.action.fromChainId
    ),
    toAsset: normalizeLiFiTokenToSwapAndBridgeToToken(step.action.toToken, step.action.toChainId),
    chainId: step.action.fromChainId,
    fromAmount: step.estimate.fromAmount,
    toAmount: step.estimate.toAmount,
    swapSlippage: step.action.slippage,
    protocol: {
      displayName: step.toolDetails.name,
      icon: step.toolDetails.logoURI,
      name: step.toolDetails.name
    },
    minAmountOut: step.estimate.toAmountMin,
    gasFees: {
      gasAmount: step.estimate.gasCosts?.[0]?.amount || '',
      gasLimit: +(step.estimate.gasCosts?.[0]?.limit || 0),
      feesInUsd: +(step.estimate.gasCosts?.[0]?.amountUSD || 0),
      asset: step.estimate.gasCosts?.[0]?.token
        ? normalizeLiFiTokenToSwapAndBridgeToToken(
            step.estimate.gasCosts[0].token,
            step.estimate.gasCosts[0].token.chainId
          )
        : undefined
    },
    // TODO:
    approvalData: null
  }))

const normalizeLiFiRouteToSwapAndBridgeRoute = (route: LiFiRoute): SwapAndBridgeRoute => ({
  routeId: route.id,
  isOnlySwapRoute: !route.containsSwitchChain,
  fromAmount: route.fromAmount,
  toAmount: route.toAmount,
  // TODO: Make optional?
  usedBridgeNames: [],
  // TODO: Make optional?
  usedDexName: '',
  totalUserTx: 1,
  totalGasFeesInUsd: +(route.gasCostUSD || 0),
  userTxs: route.steps.flatMap(normalizeLiFiStepToSwapAndBridgeUserTx),
  steps: route.steps.flatMap(normalizeLiFiStepToSwapAndBridgeStep),
  receivedValueInUsd: +route.toAmountUSD,
  inputValueInUsd: +route.fromAmountUSD,
  outputValueInUsd: +route.toAmountUSD,
  serviceTime: +route.toAmountMin,
  maxServiceTime: +route.toAmountMin,
  // errorMessage: undefined
  rawRoute: route
})

export class LiFiAPI {
  #fetch: Fetch

  #baseUrl = 'https://li.quest/v1'

  #headers: RequestInitWithCustomHeaders['headers']

  isHealthy: boolean | null = null

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#fetch = fetch

    this.#headers = {
      'x-lifi-api-key': apiKey,
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

  async getToTokenList({
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SwapAndBridgeToToken[]> {
    // TODO: Figure out a way to pull only a shortlist
    const params = new URLSearchParams({
      chains: toChainId.toString(),
      chainTypes: 'EVM'
    })
    const url = `${this.#baseUrl}/tokens?${params.toString()}`

    const response = await this.#handleResponse<LiFiTokensResponse>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix:
        'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
    })

    const result: SwapAndBridgeToToken[] = response.tokens[toChainId].map((t: LiFiToken) =>
      normalizeLiFiTokenToSwapAndBridgeToToken(t, toChainId)
    )

    return addCustomTokensIfNeeded({ chainId: toChainId, tokens: result })
  }

  async getToken({
    address: token,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null> {
    const params = new URLSearchParams({
      token: token.toString(),
      chain: chainId.toString()
    })
    const url = `${this.#baseUrl}/token?${params.toString()}`

    const response = await this.#handleResponse<LiFiToken>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to retrieve token information by address.'
    })

    if (!response) return null

    return normalizeLiFiTokenToSwapAndBridgeToToken(response, chainId)
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
    isSmartAccount,
    sort,
    isOG
  }: {
    fromAsset: TokenResult
    fromChainId: number
    fromTokenAddress: string
    toAsset: SwapAndBridgeToToken
    toChainId: number
    toTokenAddress: string
    fromAmount: bigint
    userAddress: string
    isSmartAccount: boolean
    sort: 'time' | 'output'
    isOG: InviteController['isOG']
  }): Promise<SwapAndBridgeQuote> {
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

    const response = await this.#handleResponse<LiFiRoutesResponse>({
      fetchPromise: this.#fetch(url, { headers: this.#headers, method: 'POST', body }),
      errorPrefix: 'Unable to fetch the quote.'
    })

    const selectedRoute: SwapAndBridgeRoute = response.routes[0]
      ? normalizeLiFiRouteToSwapAndBridgeRoute(response.routes[0])
      : null
    const selectedRouteSteps: SwapAndBridgeStep[] = response.routes[0]
      ? response.routes[0].steps.flatMap(normalizeLiFiStepToSwapAndBridgeStep)
      : []

    return {
      fromAsset: convertPortfolioTokenToSwapAndBridgeToToken(fromAsset, fromChainId),
      fromChainId,
      toAsset,
      toChainId,
      selectedRoute,
      selectedRouteSteps,
      routes: response.routes.map(normalizeLiFiRouteToSwapAndBridgeRoute)
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
    route: SwapAndBridgeRoute
  }) {
    const body = JSON.stringify(route.rawRoute.steps[0])

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
