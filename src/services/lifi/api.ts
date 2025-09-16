import {
  ExtendedChain as LiFiExtendedChain,
  LiFiStep,
  Route as LiFiRoute,
  RoutesResponse as LiFiRoutesResponse,
  StatusResponse as LiFiRouteStatusResponse,
  Step as LiFiIncludedStep,
  Token as LiFiToken,
  TokensResponse as LiFiTokensResponse,
  ToolError
} from '@lifi/types'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatus,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeStep,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapAndBridgeUserTx,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import { TokenResult } from '../../libs/portfolio'
import {
  addCustomTokensIfNeeded,
  attemptToSortTokensByMarketCap,
  convertPortfolioTokenToSwapAndBridgeToToken,
  getSlippage,
  isNoFeeToken,
  lifiMapNativeToAddr,
  sortNativeTokenFirst
} from '../../libs/swapAndBridge/swapAndBridge'
import { FEE_PERCENT, ZERO_ADDRESS } from '../socket/constants'
import { getHumanReadableErrorMessage } from './helpers'

const normalizeLiFiTokenToSwapAndBridgeToToken = (
  token: LiFiToken,
  toChainId: number
): SwapAndBridgeToToken => {
  const { name, address, decimals, symbol, logoURI: icon } = token

  return {
    name,
    address: lifiMapNativeToAddr(toChainId, address),
    decimals,
    symbol,
    icon,
    chainId: toChainId
  }
}

const normalizeLiFiStepToSwapAndBridgeStep = (parentStep: LiFiStep): SwapAndBridgeStep[] => {
  const includedSteps = parentStep.includedSteps
  const swapOrBridgeSteps = ['swap', 'cross']

  const isSwapOrBridge = includedSteps.some((s) => swapOrBridgeSteps.includes(s.type))

  return (
    includedSteps
      // Picks only steps that need to be visualized / displayed
      .filter(({ type }) => {
        // If it's swap or bridge we don't want to show protocol steps
        // as they are not relevant for the user
        if (isSwapOrBridge) {
          return swapOrBridgeSteps.includes(type)
        }

        // If it's not swap or bridge we want to show protocol steps
        // (Wrap / Unwrap)
        return type === 'protocol'
      })
      .map((step: LiFiIncludedStep, index: number) => ({
        chainId: step.action.fromChainId,
        fromAmount: parentStep.action.fromAmount,
        fromAsset: normalizeLiFiTokenToSwapAndBridgeToToken(
          step.action.fromToken,
          step.action.fromChainId
        ),
        serviceTime: parentStep.estimate.executionDuration,
        minAmountOut: step.estimate.toAmountMin,
        protocol: {
          name: step.toolDetails.name,
          displayName: step.toolDetails.name,
          icon: step.toolDetails.logoURI
        },
        swapSlippage: step.action.slippage,
        toAmount: step.estimate.toAmount,
        toAsset: normalizeLiFiTokenToSwapAndBridgeToToken(
          step.action.toToken,
          step.action.toChainId
        ),
        type: step.type === 'swap' ? 'swap' : 'middleware',
        userTxIndex: index
      }))
  )
}

const normalizeLiFiStepToSwapAndBridgeUserTx = (parentStep: LiFiStep): SwapAndBridgeUserTx[] =>
  parentStep.includedSteps
    // Picks only steps that need to be visualized / displayed
    .filter(({ type }) => ['swap', 'cross'].includes(type))
    .map((step: LiFiIncludedStep, index: number) => ({
      userTxIndex: index,
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
      minAmountOut: step.estimate.toAmountMin
    }))

const normalizeLiFiRouteToSwapAndBridgeRoute = (
  route: LiFiRoute,
  userAddress: string,
  accountNativeBalance: bigint,
  nativeSymbol: string
): SwapAndBridgeRoute => {
  // search for a feeCost that is not included in the quote
  // if there is one, check if the user has enough to pay for it
  // if he doesn't, mark the route as disabled
  // let serviceFee = parentStep?.estimate?.feeCosts?.filter((cost: { included: boolean }) => !cost.included) ?? []
  let serviceFee: SwapAndBridgeRoute['serviceFee']
  route.steps.forEach((step) => {
    const stepFeeCosts =
      step.estimate.feeCosts?.filter((cost: { included: boolean }) => !cost.included) ?? []
    if (stepFeeCosts.length) serviceFee = stepFeeCosts[0]
  })

  const disabled =
    serviceFee === undefined ? false : accountNativeBalance < BigInt(serviceFee.amount)
  const swapOrBridgeText = route.fromChainId === route.toChainId ? 'swap' : 'bridge'
  const disabledReason = disabled
    ? `Insufficient ${nativeSymbol}. This ${swapOrBridgeText} imposes a fee that must be paid in ${nativeSymbol}.`
    : undefined

  return {
    providerId: 'lifi',
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
    userTxs: route.steps.flatMap(normalizeLiFiStepToSwapAndBridgeUserTx),
    steps: route.steps.flatMap(normalizeLiFiStepToSwapAndBridgeStep),
    inputValueInUsd: +route.fromAmountUSD,
    outputValueInUsd: +route.toAmountUSD,
    serviceTime: route.steps[0].estimate.executionDuration,
    rawRoute: route,
    sender: route.fromAddress,
    toToken: route.toToken,
    disabled,
    disabledReason,
    serviceFee
  }
}

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
    userTxIndex: 0,
    value: parentStep.transactionRequest.value
  }
}

export class LiFiAPI implements SwapProvider {
  id: string = 'lifi'

  name: string = 'LiFi'

  #fetch: Fetch

  #baseUrl = 'https://li.quest/v1'

  #headers: RequestInitWithCustomHeaders['headers']

  #requestTimeoutMs = 10000

  isHealthy: boolean | null = null

  #apiKey: string

  /**
   * We don't use the apiKey as a default option for sending LiFi API
   * requests, we let a custom rate limit be set per user.
   * If the user hits that rate limit, we add the key for a set amount
   * of time so he could continue using lifi. The key is exposed on
   * the FE and anyone can use it and therefore break it (hit the rate
   * limit), so we only use it as a backup
   */
  #apiKeyActivatedTimestamp?: number

  constructor({ fetch }: { fetch: Fetch }) {
    this.#fetch = fetch

    this.#headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }

    this.#apiKey = process.env.LI_FI_API_KEY!
  }

  activateApiKey() {
    this.#headers['x-lifi-api-key'] = this.#apiKey
    this.#apiKeyActivatedTimestamp = Date.now()
  }

  deactivateApiKeyIfStale() {
    if (!this.#apiKeyActivatedTimestamp) return

    const twoHoursPassed = Date.now() - this.#apiKeyActivatedTimestamp >= 120 * 60 * 1000
    if (!twoHoursPassed) return

    delete this.#headers['x-lifi-api-key']
    this.#apiKeyActivatedTimestamp = undefined
  }

  // eslint-disable-next-line class-methods-use-this
  async getHealth() {
    // Li.Fi's v1 API doesn't have a dedicated health endpoint
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
    // start by removing the API key if a set time has passed
    // we use the api key only when we hit the rate limit
    this.deactivateApiKeyIfStale()

    let response: CustomResponse

    try {
      response = await Promise.race([
        fetchPromise,
        new Promise<CustomResponse>((_, reject) => {
          setTimeout(() => {
            reject(
              new SwapAndBridgeProviderApiError(
                'Our service provider is temporarily unavailable or your internet connection is too slow. Error details: Request timeout'
              )
            )
          }, this.#requestTimeoutMs)
        })
      ])
    } catch (e: any) {
      // Rethrow the same error if it's already humanized
      if (e instanceof SwapAndBridgeProviderApiError) throw e

      const message = e?.message || 'no message'
      const status = e?.status ? `, status: <${e.status}>` : ''
      const error = `${errorPrefix} Our service provider LiFi could not be reached: <${message}>${status}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (response.status === 429) {
      this.activateApiKey()
      const error =
        'Our service provider LiFi received too many requests, temporarily preventing your request from being processed.'
      throw new SwapAndBridgeProviderApiError(error, 'Rate limit reached, try again later.')
    }

    let responseBody: T
    try {
      responseBody = await response.json()
    } catch (e: any) {
      const error = 'Our service provider LiFi is temporarily unavailable.'
      throw new SwapAndBridgeProviderApiError(error)
    }

    if (!response.ok) {
      const humanizedMessage = getHumanReadableErrorMessage(errorPrefix, responseBody)

      if (humanizedMessage) {
        throw new SwapAndBridgeProviderApiError(humanizedMessage)
      }

      const upstreamMessage = (responseBody as ToolError)?.message
      const upstreamCode = (responseBody as ToolError)?.code

      const fallbackMessage =
        // Upstream error coming from LiFi, that must be the most accurate
        upstreamMessage && upstreamCode
          ? `${upstreamMessage} Reference: ${upstreamCode}`
          : upstreamMessage || JSON.stringify(responseBody).slice(0, 250) // up to about 5 lines of toast

      const error = `${errorPrefix} Our service provider LiFi responded: <${fallbackMessage}>`
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

    const tokens: SwapAndBridgeToToken[] = response.tokens[toChainId].map((t: LiFiToken) =>
      normalizeLiFiTokenToSwapAndBridgeToToken(t, toChainId)
    )

    const sortedTokens = await attemptToSortTokensByMarketCap({
      fetch: this.#fetch,
      chainId: toChainId,
      tokens
    })

    const withCustomTokens = addCustomTokensIfNeeded({ chainId: toChainId, tokens: sortedTokens })

    return sortNativeTokenFirst(withCustomTokens)
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
    isOG,
    accountNativeBalance,
    nativeSymbol
  }: {
    fromAsset: TokenResult | null
    fromChainId: number
    fromTokenAddress: string
    toAsset: SwapAndBridgeToToken | null
    toChainId: number
    toTokenAddress: string
    fromAmount: bigint
    userAddress: string
    sort: 'time' | 'output'
    isOG: boolean
    accountNativeBalance: bigint
    nativeSymbol: string
  }): Promise<SwapAndBridgeQuote> {
    if (!fromAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <from token details are missing>'
      )
    if (!toAsset)
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but missing required params. Error details: <to token details are missing>'
      )

    const body = {
      fromChainId: fromChainId.toString(),
      fromAmount: fromAmount.toString(),
      fromTokenAddress: lifiMapNativeToAddr(fromChainId, fromTokenAddress),
      toChainId: toChainId.toString(),
      toTokenAddress: lifiMapNativeToAddr(toChainId, toTokenAddress),
      fromAddress: userAddress,
      toAddress: userAddress,
      options: {
        slippage: getSlippage(fromAsset, fromAmount, '0.01', 0.005),
        maxPriceImpact: '0.50',
        order: sort === 'time' ? 'FASTEST' : 'CHEAPEST',
        integrator: 'ambire-extension-prod',
        // These two flags ensure we have NO transaction on the destination chain
        allowDestinationCall: 'false',
        allowSwitchChain: 'false',
        // LiFi fee is from 0 to 1, so normalize it by dividing by 100
        fee: (FEE_PERCENT / 100).toString() as string | undefined,
        // How this works:
        // When this strategy is applied, we give all tool 900ms (minWaitTimeMs) to return a result.
        // If we received 5 or more (startingExpectedResults) results during this time we return those and don’t wait for other tools.
        // If less than 5 results are present we wait another 300ms and check if now at least (5-1=4) results are present.
        timing: {
          // Applied in swaps
          swapStepTimingStrategies: [
            {
              strategy: 'minWaitTime',
              minWaitTimeMs: 900,
              startingExpectedResults: 5,
              reduceEveryMs: 300
            }
          ],
          // Applied in bridges
          routeTimingStrategies: [
            {
              strategy: 'minWaitTime',
              minWaitTimeMs: 1500,
              startingExpectedResults: 5,
              reduceEveryMs: 300
            }
          ]
        }
      }
    }

    const shouldRemoveConvenienceFee = isOG || isNoFeeToken(fromChainId, fromTokenAddress)
    if (shouldRemoveConvenienceFee) delete body.options.fee

    const url = `${this.#baseUrl}/advanced/routes`
    const response = await this.#handleResponse<LiFiRoutesResponse>({
      fetchPromise: this.#fetch(url, {
        headers: this.#headers,
        method: 'POST',
        body: JSON.stringify(body)
      }),
      errorPrefix: 'Unable to fetch the quote.'
    })

    return {
      fromAsset: convertPortfolioTokenToSwapAndBridgeToToken(fromAsset, fromChainId),
      fromChainId,
      toAsset,
      toChainId,
      routes: response.routes.map((r: LiFiRoute) =>
        normalizeLiFiRouteToSwapAndBridgeRoute(r, userAddress, accountNativeBalance, nativeSymbol)
      ),
      // selecting a route is a controller's responsiilibty, not the API's
      selectedRoute: undefined,
      selectedRouteSteps: []
    }
  }

  async startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest> {
    const body = JSON.stringify((route.rawRoute as LiFiRoute).steps[0])

    const response = await this.#handleResponse<LiFiStep>({
      // skipSimulation reduces the time it takes for the request to complete.
      // By default LiFi does additional calculations/calls to make the gasLimit more accurate
      // This is fine for use, because we don't use it anyway
      fetchPromise: this.#fetch(`${this.#baseUrl}/advanced/stepTransaction?skipSimulation=true`, {
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
    txHash: string
    fromChainId: number
    toChainId: number
    bridge?: string
  }): Promise<SwapAndBridgeRouteStatus> {
    if (!bridge) return 'completed'

    const params = new URLSearchParams({
      txHash,
      bridge,
      fromChain: fromChainId.toString(),
      toChain: toChainId.toString()
    })
    const url = `${this.#baseUrl}/status?${params.toString()}`

    // no error handling on getRouteStatus. Swallow the error and always return
    // a pending route result and try again. This is the best decision after
    // discussing it with Li.Fi. as in our one-swap, one-bridge design the
    // only errors that should be returned are once that will disappear after time
    const response = await this.#handleResponse<LiFiRouteStatusResponse>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
    }).catch((e) => e)

    const statuses: {
      DONE: SwapAndBridgeRouteStatus
      FAILED: SwapAndBridgeRouteStatus
      INVALID: SwapAndBridgeRouteStatus
      NOT_FOUND: SwapAndBridgeRouteStatus
      PENDING: SwapAndBridgeRouteStatus
      REFUNDED: SwapAndBridgeRouteStatus
    } = {
      DONE: 'completed',
      FAILED: null,
      INVALID: null,
      NOT_FOUND: null,
      PENDING: null,
      // when the bridge has failed and the user has received back his tokens
      REFUNDED: 'refunded'
    }

    if (response instanceof SwapAndBridgeProviderApiError) {
      return statuses.PENDING
    }

    if (response.substatus && response.substatus === 'REFUNDED') {
      return statuses.REFUNDED
    }

    return statuses[response.status as LiFiRouteStatusResponse['status']]
  }
}
