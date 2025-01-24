import { getAddress } from 'ethers'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { CustomResponse, Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SocketAPIActiveRoutes,
  SocketAPIQuote,
  SocketAPISendTransactionRequest,
  SocketAPISupportedChain,
  SocketAPIToken
} from '../../interfaces/swapAndBridge'
import {
  AMBIRE_FEE_TAKER_ADDRESSES,
  AMBIRE_WALLET_TOKEN_ON_BASE,
  AMBIRE_WALLET_TOKEN_ON_ETHEREUM,
  ETH_ON_OPTIMISM_LEGACY_ADDRESS,
  FEE_PERCENT,
  NULL_ADDRESS,
  ZERO_ADDRESS
} from './constants'

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

export class SocketAPI {
  #fetch: Fetch

  #baseUrl = 'https://api.socket.tech/v2'

  #headers: RequestInitWithCustomHeaders['headers']

  isHealthy: boolean | null = null

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#fetch = fetch

    this.#headers = {
      'API-KEY': apiKey,
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

  // TODO: Refine types
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
      const status = e?.status || 'unknown'
      const error = `${errorPrefix} Upstream error: ${message}, status: ${status}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    let responseBody: T
    try {
      responseBody = await response.json()
    } catch (e: any) {
      const message = e?.message || 'no message'
      const error = `${errorPrefix} Error details: Unexpected non-JSON response from our service provider, message: ${message}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    const isBadResponse = !response.ok
    // Socket API returns 500 status code with a message in the body, even
    // in case of a bad request. Not necessarily an internal server error.
    // TODO: Not sure if !response.success this will click well with the getSupportedChains method.
    if (isBadResponse || !responseBody?.success) {
      // API returns 2 types of errors, a generic one, on the top level:
      const genericErrorMessage = responseBody?.message?.error || 'no message'
      // ... and a detailed one, nested in the `details` object:
      const specificErrorMessage = responseBody?.message?.details?.error?.message || 'no details'
      const specificErrorCode = responseBody?.message?.details?.error?.code || 'no code'
      const error = `${errorPrefix} Our service provider upstream error: ${genericErrorMessage}, details: ${specificErrorMessage}, code: ${specificErrorCode}`
      throw new SwapAndBridgeProviderApiError(error)
    }

    // Do not wait on purpose, to not block or delay the response
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateHealthIfNeeded()

    return responseBody.result
  }

  async getSupportedChains(): Promise<SocketAPISupportedChain[]> {
    const url = `${this.#baseUrl}/supported/chains`

    let response = await this.#fetch(url, { headers: this.#headers })
    const fallbackError = new Error(
      'Unable to retrieve the list of supported Swap & Bridge chains from our service provider.'
    )
    if (!response.ok) throw fallbackError

    response = await response.json()
    if (!response.success) throw fallbackError
    await this.updateHealthIfNeeded()

    return response.result
  }

  async getToTokenList({
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SocketAPIToken[]> {
    const params = new URLSearchParams({
      fromChainId: fromChainId.toString(),
      toChainId: toChainId.toString(),
      // The long list for some networks is HUGE (e.g. Ethereum has 10,000+ tokens),
      // which makes serialization and deserialization of this controller computationally expensive.
      isShortList: 'true'
    })
    const url = `${this.#baseUrl}/token-lists/to-token-list?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    const fallbackError = new Error(
      'Unable to retrieve the list of supported receive tokens. Please reload the tab to try again.'
    )
    if (!response.ok) throw fallbackError

    response = await response.json()
    if (!response.success) throw fallbackError
    await this.updateHealthIfNeeded()

    let { result } = response
    // Exception for Optimism, strip out the legacy ETH address
    // TODO: Remove when Socket removes the legacy ETH address from their response
    if (toChainId === 10)
      result = result.filter(
        (token: SocketAPIToken) => token.address !== ETH_ON_OPTIMISM_LEGACY_ADDRESS
      )

    // Exception for Ethereum, duplicate ETH tokens are incoming from the API.
    // One is with the `ZERO_ADDRESS` and one with `NULL_ADDRESS`, both for ETH.
    // Strip out the one with the `ZERO_ADDRESS` to be consistent with the rest.
    if (toChainId === 1)
      result = result.filter((token: SocketAPIToken) => token.address !== ZERO_ADDRESS)

    // Since v4.41.0 we request the shortlist from Socket, which does not include
    // the Ambire $WALLET token. So adding it manually on the supported chains.
    if (toChainId === 1) result.unshift(AMBIRE_WALLET_TOKEN_ON_ETHEREUM)
    if (toChainId === 8453) result.unshift(AMBIRE_WALLET_TOKEN_ON_BASE)

    return result.map(normalizeIncomingSocketToken)
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SocketAPIToken | null> {
    const params = new URLSearchParams({
      address: address.toString(),
      chainId: chainId.toString()
    })
    const url = `${this.#baseUrl}/supported/token-support?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    const fallbackError = new Error('Failed to retrieve token information by address.')
    if (!response.ok) throw fallbackError

    response = await response.json()
    if (!response.success) throw fallbackError
    await this.updateHealthIfNeeded()

    if (!response.result.isSupported || !response.result.token) return null

    return normalizeIncomingSocketToken(response.result.token)
  }

  async quote({
    fromChainId,
    fromTokenAddress,
    toChainId,
    toTokenAddress,
    fromAmount,
    userAddress,
    isSmartAccount,
    sort
  }: {
    fromChainId: number
    fromTokenAddress: string
    toChainId: number
    toTokenAddress: string
    fromAmount: bigint
    userAddress: string
    isSmartAccount: boolean
    sort: 'time' | 'output'
  }): Promise<SocketAPIQuote> {
    const params = new URLSearchParams({
      fromChainId: fromChainId.toString(),
      fromTokenAddress: normalizeOutgoingSocketTokenAddress(fromTokenAddress),
      toChainId: toChainId.toString(),
      toTokenAddress: normalizeOutgoingSocketTokenAddress(toTokenAddress),
      fromAmount: fromAmount.toString(),
      userAddress,
      isContractCall: isSmartAccount.toString(), // only get quotes with that are compatible with contracts
      sort,
      singleTxOnly: 'false',
      defaultSwapSlippage: '1',
      uniqueRoutesPerBridge: 'true'
    })
    const feeTakerAddress = AMBIRE_FEE_TAKER_ADDRESSES[fromChainId]
    const shouldIncludeConvenienceFee = !!feeTakerAddress
    if (shouldIncludeConvenienceFee) {
      params.append('feeTakerAddress', feeTakerAddress)
      params.append('feePercent', FEE_PERCENT.toString())
    }
    const url = `${this.#baseUrl}/quote?${params.toString()}`

    const response = await this.#handleResponse<SocketAPIQuote>({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to fetch the quote.'
    })

    return {
      ...response,
      fromAsset: normalizeIncomingSocketToken(response.fromAsset),
      toAsset: normalizeIncomingSocketToken(response.toAsset),
      routes: response.routes.map((route) => ({
        ...route,
        userTxs: route.userTxs.map((userTx) => ({
          ...userTx,
          ...('fromAsset' in userTx && {
            fromAsset: normalizeIncomingSocketToken(userTx.fromAsset)
          }),
          toAsset: normalizeIncomingSocketToken(userTx.toAsset),
          ...('steps' in userTx && {
            steps: userTx.steps.map((step) => ({
              ...step,
              fromAsset: normalizeIncomingSocketToken(step.fromAsset),
              toAsset: normalizeIncomingSocketToken(step.toAsset)
            }))
          })
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
    route: SocketAPIQuote['selectedRoute']
  }) {
    const params = {
      fromChainId,
      toChainId,
      fromAssetAddress: normalizeOutgoingSocketTokenAddress(fromAssetAddress),
      toAssetAddress: normalizeOutgoingSocketTokenAddress(toAssetAddress),
      includeFirstTxDetails: true,
      route: {
        ...route,
        userTxs: route.userTxs.map((userTx) => ({
          ...userTx,
          // @ts-ignore fromAsset exists on one of the two userTx sub-types
          fromAsset: userTx?.fromAsset ? normalizeOutgoingSocketToken(userTx.fromAsset) : undefined,
          toAsset: {
            ...userTx.toAsset,
            address: normalizeOutgoingSocketTokenAddress(userTx.toAsset.address)
          },
          // @ts-ignore fromAsset exists on one of the two userTx sub-types
          steps: userTx.steps
            ? // @ts-ignore fromAsset exists on one of the two userTx sub-types
              userTx.steps.map((step) => ({
                ...step,
                fromAsset: normalizeOutgoingSocketToken(step.fromAsset),
                toAsset: normalizeOutgoingSocketToken(step.toAsset)
              }))
            : undefined
        }))
      }
    }

    const response = await this.#handleResponse({
      fetchPromise: this.#fetch(`${this.#baseUrl}/route/start`, {
        method: 'POST',
        headers: this.#headers,
        body: JSON.stringify(params)
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

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to update route')
    await this.updateHealthIfNeeded()

    response = await response.json()
    return response
  }

  async updateActiveRoute(
    activeRouteId: SocketAPISendTransactionRequest['activeRouteId']
  ): Promise<SocketAPIActiveRoutes> {
    const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() })
    const url = `${this.#baseUrl}/route/active-routes?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to update route')

    response = await response.json()
    if (!response.success) throw new Error('Failed to update route')
    await this.updateHealthIfNeeded()

    return {
      ...response.result,
      fromAsset: normalizeIncomingSocketToken(response.result.fromAsset),
      fromAssetAddress: normalizeIncomingSocketTokenAddress(response.result.fromAssetAddress),
      toAsset: normalizeIncomingSocketToken(response.result.toAsset),
      toAssetAddress: normalizeIncomingSocketTokenAddress(response.result.toAssetAddress),
      userTxs: (response.result.userTxs as SocketAPIActiveRoutes['userTxs']).map((userTx) => ({
        ...userTx,
        fromAsset:
          'fromAsset' in userTx ? normalizeIncomingSocketToken(userTx.fromAsset) : undefined,
        toAsset: normalizeIncomingSocketToken(userTx.toAsset),
        steps:
          'steps' in userTx
            ? userTx.steps.map((step) => ({
                ...step,
                fromAsset: normalizeIncomingSocketToken(step.fromAsset),
                toAsset: normalizeIncomingSocketToken(step.toAsset)
              }))
            : undefined
      }))
    }
  }

  async getNextRouteUserTx(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() })
    const url = `${this.#baseUrl}/route/build-next-tx?${params.toString()}`

    const response = await this.#handleResponse({
      fetchPromise: this.#fetch(url, { headers: this.#headers }),
      errorPrefix: 'Unable to start the next step.'
    })

    return response
  }
}
