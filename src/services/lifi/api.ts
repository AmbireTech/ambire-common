import {
  ExtendedChain as LiFiExtendedChain,
  Step as LiFiIncludedStep,
  Route as LiFiRoute,
  RoutesResponse as LiFiRoutesResponse,
  StatusResponse as LiFiRouteStatusResponse,
  LiFiStep,
  Token as LiFiToken,
  TokensResponse as LiFiTokensResponse
} from '@lifi/types'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { InviteController } from '../../controllers/invite/invite'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SwapAndBridgeActiveRoute,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatus,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeStep,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapAndBridgeUserTx
} from '../../interfaces/swapAndBridge'
import { TokenResult } from '../../libs/portfolio'
import {
  addCustomTokensIfNeeded,
  convertPortfolioTokenToSwapAndBridgeToToken
} from '../../libs/swapAndBridge/swapAndBridge'
import { FEE_PERCENT, ZERO_ADDRESS } from '../socket/constants'
import { disabledAssetSymbols, MAYAN_BRIDGE } from './consts'

const normalizeLiFiTokenToSwapAndBridgeToToken = (
  token: LiFiToken,
  toChainId: number
): SwapAndBridgeToToken => {
  const { name, address, decimals, symbol, logoURI: icon } = token

  return { name, address, decimals, symbol, icon, chainId: toChainId }
}

const normalizeLiFiStepToSwapAndBridgeStep = (parentStep: LiFiStep): SwapAndBridgeStep[] =>
  parentStep.includedSteps
    // Picks only steps that need to be visualized / displayed
    .filter(({ type }) => ['swap', 'cross'].includes(type))
    .map((step: LiFiIncludedStep, index: number) => ({
      chainId: step.action.fromChainId,
      fromAmount: parentStep.action.fromAmount,
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
      serviceTime: parentStep.estimate.executionDuration,
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
  parentStep.includedSteps
    // Picks only steps that need to be visualized / displayed
    .filter(({ type }) => ['swap', 'cross'].includes(type))
    .map((step: LiFiIncludedStep, index: number) => ({
      userTxType: step.type === 'swap' ? 'dex-swap' : 'fund-movr',
      userTxIndex: index,
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
      serviceTime: parentStep.estimate.executionDuration,
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
      }
    }))

const normalizeLiFiRouteToSwapAndBridgeRoute = (
  route: LiFiRoute,
  userAddress: string
): SwapAndBridgeRoute => ({
  routeId: route.id,
  fromChainId: route.fromChainId,
  toChainId: route.toChainId,
  userAddress,
  isOnlySwapRoute: !route.containsSwitchChain,
  fromAmount: route.fromAmount,
  toAmount: route.toAmount,
  currentUserTxIndex: 0,
  ...(route.steps[0].includedSteps.some((s) => s.type === 'cross')
    ? { usedBridgeNames: [route.steps[0].toolDetails.key] }
    : { usedDexName: route.steps[0].toolDetails.name }),
  totalGasFeesInUsd: +(route.gasCostUSD || 0),
  userTxs: route.steps.flatMap(normalizeLiFiStepToSwapAndBridgeUserTx),
  steps: route.steps.flatMap(normalizeLiFiStepToSwapAndBridgeStep),
  receivedValueInUsd: +route.toAmountUSD,
  inputValueInUsd: +route.fromAmountUSD,
  outputValueInUsd: +route.toAmountUSD,
  serviceTime: route.steps[0].estimate.executionDuration,
  // errorMessage: undefined
  rawRoute: route,
  sender: route.fromAddress
})

const normalizeLiFiStepToSwapAndBridgeSendTxRequest = (
  parentStep: LiFiStep
): SwapAndBridgeSendTxRequest => {
  if (
    !parentStep.transactionRequest ||
    typeof parentStep.transactionRequest.data !== 'string' ||
    typeof parentStep.transactionRequest.to !== 'string' ||
    typeof parentStep.transactionRequest.value !== 'string'
  ) {
    throw new SwapAndBridgeProviderApiError(
      'Unable to start the route. Error details: <missing transaction request data>'
    )
  }

  return {
    // Route ID is the string before the colon, then it's the step index
    activeRouteId: parentStep.id.split(':')[0],
    approvalData:
      parentStep.action.fromToken.address === ZERO_ADDRESS
        ? null // No approval needed fo native tokens
        : {
            allowanceTarget: parentStep.estimate.approvalAddress,
            approvalTokenAddress: parentStep.action.fromToken.address,
            minimumApprovalAmount: parentStep.estimate.fromAmount,
            owner: ''
          },
    chainId: parentStep.action.fromChainId,
    txData: parentStep.transactionRequest.data,
    txTarget: parentStep.transactionRequest.to,
    txType: 'eth_sendTransaction',
    userTxIndex: 0,
    userTxType: parentStep.includedSteps.some((s) => s.type === 'cross') ? 'fund-movr' : 'dex-swap',
    value: parentStep.transactionRequest.value
  }
}

export class LiFiAPI {
  id: 'lifi' = 'lifi'

  #fetch: Fetch

  #baseUrl = 'https://li.quest/v1'

  #headers: RequestInitWithCustomHeaders['headers']

  isHealthy: boolean | null = null

  constructor({ apiKey, fetch }: { apiKey?: string; fetch: Fetch }) {
    this.#fetch = fetch

    this.#headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    // add the apiKey if specified only. Li Fi can function without an apiKey,
    // it will just put a custom user rate limit
    if (apiKey) {
      this.#headers['x-lifi-api-key'] = apiKey
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async getHealth() {
    // Li.Fi’s v1 API doesn't have a dedicated health endpoint
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

  /**
   * Processes LiFi API responses and throws custom errors for various failures
   */
  // eslint-disable-next-line class-methods-use-this
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

    let responseBody: T
    try {
      responseBody = await response.json()
    } catch (e: any) {
      const message = e?.message || 'no message'
      const error = `${errorPrefix} Error details: <Unexpected non-JSON response from our service provider>, message: <${message}>`
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (!response.ok) {
      const message = JSON.stringify(responseBody)
      const error = `${errorPrefix} Our service provider upstream error: <${message}>`
      throw new SwapAndBridgeProviderApiError(error)
    }

    return responseBody
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const url = `${this.#baseUrl}/chains?chainTypes=EVM`

    const response = await this.#handleResponse<{ chains: LiFiExtendedChain[] }>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix:
        'Unable to retrieve the list of supported Swap & Bridge chains from our service provider.'
    })

    return response.chains.map((c) => ({ chainId: c.id }))
  }

  async getToTokenList({
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SwapAndBridgeToToken[]> {
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
    sort,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    isOG
  }: {
    fromAsset: TokenResult | null
    fromChainId: number
    fromTokenAddress: string
    toAsset: SwapAndBridgeToToken | null
    toChainId: number
    toTokenAddress: string
    fromAmount: bigint
    userAddress: string
    isSmartAccount: boolean
    sort: 'time' | 'output'
    isOG: InviteController['isOG']
  }): Promise<SwapAndBridgeQuote> {
    if (!fromAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <from token details are missing>'
      )
    if (!toAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <to token details are missing>'
      )

    // if the from asset is disabled, we don't return routes
    // currently, stETH is disabled because returned routes for it
    // always end up in a failure
    if (disabledAssetSymbols.indexOf(fromAsset.symbol) !== -1) {
      return {
        fromAsset: convertPortfolioTokenToSwapAndBridgeToToken(fromAsset, fromChainId),
        fromChainId,
        toAsset,
        toChainId,
        selectedRouteSteps: [],
        routes: []
      }
    }

    const body = {
      fromChainId: fromChainId.toString(),
      fromAmount: fromAmount.toString(),
      fromTokenAddress,
      toChainId: toChainId.toString(),
      toTokenAddress,
      fromAddress: userAddress,
      toAddress: userAddress,
      options: {
        slippage: '0.005',
        order: sort === 'time' ? 'FASTEST' : 'CHEAPEST',
        integrator: 'ambire-extension-prod',
        // These two flags ensure we have NO transaction on the destination chain
        allowDestinationCall: 'false',
        allowSwitchChain: 'false',
        // LiFi fee is from 0 to 1, so normalize it by dividing by 100
        fee: (FEE_PERCENT / 100).toString() as string | undefined
      }
    }

    // const shouldRemoveConvenienceFee = isOG
    // if (shouldRemoveConvenienceFee) delete body.options.fee

    const url = `${this.#baseUrl}/advanced/routes`
    const response = await this.#handleResponse<LiFiRoutesResponse>({
      fetchPromise: this.#fetch(url, {
        headers: this.#headers,
        method: 'POST',
        body: JSON.stringify(body)
      }),
      errorPrefix: 'Unable to fetch the quote.'
    })

    const routes = response.routes
      .map((r: LiFiRoute) => normalizeLiFiRouteToSwapAndBridgeRoute(r, userAddress))
      .filter((r: SwapAndBridgeRoute) => {
        return !r.usedBridgeNames || r.usedBridgeNames.indexOf(MAYAN_BRIDGE) === -1
      })

    const selectedRoute = response.routes[0]
      ? normalizeLiFiRouteToSwapAndBridgeRoute(response.routes[0], userAddress)
      : undefined
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
      routes
    }
  }

  async startRoute({
    route
  }: {
    fromChainId?: number
    toChainId?: number
    fromAssetAddress?: string
    toAssetAddress?: string
    route?: SwapAndBridgeRoute
  }): Promise<SwapAndBridgeSendTxRequest> {
    const body = JSON.stringify((route?.rawRoute as LiFiRoute).steps[0])

    const response = await this.#handleResponse<LiFiStep>({
      fetchPromise: this.#fetch(`${this.#baseUrl}/advanced/stepTransaction`, {
        method: 'POST',
        headers: this.#headers,
        body
      }),
      errorPrefix: 'Unable to start the route.'
    })

    return normalizeLiFiStepToSwapAndBridgeSendTxRequest(response)
  }

  async getRouteStatus({
    txHash,
    fromChainId,
    toChainId,
    bridge
  }: {
    activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']
    userTxIndex: SwapAndBridgeSendTxRequest['userTxIndex']
    txHash: string
    fromChainId: number
    toChainId: number
    bridge?: string
  }) {
    // TODO: Swaps have no status check
    if (!bridge) return 'completed'

    const params = new URLSearchParams({
      txHash,
      bridge,
      fromChain: fromChainId.toString(),
      toChain: toChainId.toString()
    })
    const url = `${this.#baseUrl}/status?${params.toString()}`

    const response = await this.#handleResponse<LiFiRouteStatusResponse>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
    })

    const statuses: { [key in LiFiRouteStatusResponse['status']]: SwapAndBridgeRouteStatus } = {
      DONE: 'completed',
      FAILED: null,
      INVALID: null,
      NOT_FOUND: null,
      PENDING: null
    }

    return statuses[response.status]
  }

  /**
   * NOT SUPPORTED: LiFi has no concept for retrieving active routes from the API.
   * @deprecated
   */
  // eslint-disable-next-line class-methods-use-this
  getActiveRoute() {
    return Promise.resolve(null)
  }

  async getNextRouteUserTx({
    route
  }: {
    activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId']
    route: SwapAndBridgeRoute
  }) {
    // LiFi has no concept for retrieving next route user tx from the API, since
    // we're using their single tx flow anyways. So re-use starting route.
    return this.startRoute({ route })
  }
}
