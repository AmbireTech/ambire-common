import { getAddress } from 'ethers'

import {
  ExtendedChain as LiFiExtendedChain,
  LiFiStep,
  Route as LiFiRoute,
  RoutesResponse as LiFiRoutesResponse,
  StatusResponse as LiFiRouteStatusResponse,
  Step as LiFiIncludedStep,
  Token as LiFiToken,
  TokensResponse as LiFiTokensResponse
} from '@lifi/types'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { InviteController } from '../../controllers/invite/invite'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SocketAPIToken,
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
import { FEE_PERCENT, NULL_ADDRESS, ZERO_ADDRESS } from '../socket/constants'

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
  parentStep.includedSteps
    // Picks only steps that need to be visualized / displayed
    .filter(({ type }) => ['swap', 'cross'].includes(type))
    .map((step: LiFiIncludedStep, index: number) => ({
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
  // Single txn flow would always result only 1 LiFi (parent) step
  currentUserTxIndex: 0,
  ...(route.steps[0].includedSteps.some((s) => s.type === 'cross')
    ? { usedBridgeNames: [route.steps[0].toolDetails.key] }
    : { usedDexName: route.steps[0].toolDetails.name }),
  totalUserTx: 1,
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
): SwapAndBridgeSendTxRequest => ({
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
  totalUserTx: 1,
  txData: parentStep.transactionRequest?.data,
  txTarget: parentStep.transactionRequest?.to,
  txType: 'eth_sendTransaction',
  userTxIndex: 0,
  userTxType: parentStep.includedSteps.some((s) => s.type === 'cross') ? 'fund-movr' : 'dex-swap',
  value: parentStep.transactionRequest?.value
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
    const body = {
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
        integrator: 'ambire-extension',
        // These two flags ensure we have NO transaction on the destination chain
        allowDestinationCall: 'true',
        allowSwitchChain: 'false'
      }
    }

    const shouldIncludeConvenienceFee = !isOG
    if (shouldIncludeConvenienceFee) {
      // TODO: Enable convenience fee
      // LiFi fee is from 0 to 1, so normalize it by dividing by 100
      // body.options.fee = (FEE_PERCENT / 100).toString()
    }

    const url = `${this.#baseUrl}/advanced/routes`
    const response = await this.#handleResponse<LiFiRoutesResponse>({
      fetchPromise: this.#fetch(url, {
        headers: this.#headers,
        method: 'POST',
        body: JSON.stringify(body)
      }),
      errorPrefix: 'Unable to fetch the quote.'
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
      routes: response.routes.map((r) => normalizeLiFiRouteToSwapAndBridgeRoute(r, userAddress))
    }
  }

  async startRoute({
    route
  }: {
    fromChainId?: number
    toChainId?: number
    fromAssetAddress?: string
    toAssetAddress?: string
    route: SwapAndBridgeRoute
  }): Promise<SwapAndBridgeSendTxRequest> {
    const body = JSON.stringify((route.rawRoute as LiFiRoute).steps[0])

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
