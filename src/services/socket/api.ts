import { getAddress } from 'ethers'

import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SocketAPIQuote,
  SocketAPISendTransactionRequest,
  SocketAPIToken
} from '../../interfaces/swapAndBridge'
import {
  AMBIRE_FEE_TAKER_ADDRESSES,
  ETH_ON_OPTIMISM_LEGACY_ADDRESS,
  FEE_PERCENT,
  NULL_ADDRESS,
  ZERO_ADDRESS
} from './constants'

const convertZeroAddressToNullAddressIfNeeded = (addr: string) =>
  addr === ZERO_ADDRESS ? NULL_ADDRESS : addr

const convertNullAddressToZeroAddressIfNeeded = (addr: string) =>
  addr === NULL_ADDRESS ? ZERO_ADDRESS : addr

const normalizeIncomingSocketToken = (token: SocketAPIToken) => ({
  ...token,
  address:
    // incoming token addresses from Socket are all lowercased
    getAddress(
      // native token addresses come as null address instead of the zero address
      convertNullAddressToZeroAddressIfNeeded(token.address)
    )
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
      // TODO: To be discussed
      isShortList: 'false'
    })
    const url = `${this.#baseUrl}/token-lists/to-token-list?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    const fallbackError = new Error('Failed to fetch to token list') // TODO: improve wording
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

    return result.map(normalizeIncomingSocketToken)
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
  }) {
    const params = new URLSearchParams({
      fromChainId: fromChainId.toString(),
      fromTokenAddress: normalizeOutgoingSocketTokenAddress(fromTokenAddress),
      toChainId: toChainId.toString(),
      toTokenAddress: normalizeOutgoingSocketTokenAddress(toTokenAddress),
      fromAmount: fromAmount.toString(),
      userAddress,
      // TODO: Enable when needed
      // feeTakerAddress: AMBIRE_FEE_TAKER_ADDRESSES[fromChainId],
      // feePercent: FEE_PERCENT.toString(),
      isContractCall: isSmartAccount.toString(), // only get quotes with that are compatible with contracts
      sort,
      singleTxOnly: 'false',
      defaultSwapSlippage: '1',
      uniqueRoutesPerBridge: 'true'
    })
    const url = `${this.#baseUrl}/quote?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to fetch quote')

    response = await response.json()
    if (!response.success) throw new Error('Failed to fetch quote')
    await this.updateHealthIfNeeded()

    return {
      ...response.result,
      fromAsset: normalizeIncomingSocketToken(response.result.fromAsset),
      toAsset: normalizeIncomingSocketToken(response.result.toAsset),
      routes: response.result.routes.map((route: SocketAPIQuote['selectedRoute']) => ({
        ...route,
        userTxs: route.userTxs.map((userTx) => ({
          ...userTx,
          // @ts-ignore fromAsset exists on one of the two userTx sub-types
          fromAsset: userTx.fromAsset ? normalizeIncomingSocketToken(userTx.fromAsset) : undefined,
          toAsset: normalizeIncomingSocketToken(userTx.toAsset),
          // @ts-ignore fromAsset exists on one of the two userTx sub-types
          steps: userTx.steps
            ? // @ts-ignore fromAsset exists on one of the two userTx sub-types
              userTx.steps.map((step) => ({
                ...step,
                fromAsset: normalizeIncomingSocketToken(step.fromAsset),
                toAsset: normalizeIncomingSocketToken(step.toAsset)
              }))
            : undefined
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

    let response = await this.#fetch(`${this.#baseUrl}/route/start`, {
      // @ts-ignore
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(params)
    })
    if (!response.ok) throw new Error('Failed to start the route')

    response = await response.json()
    if (!response.success) throw new Error('Failed to start the route')
    await this.updateHealthIfNeeded()

    return response.result
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

  async updateActiveRoute(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() })
    const url = `${this.#baseUrl}/route/active-routes?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to update route')

    response = await response.json()
    if (!response.success) throw new Error('Failed to update route')
    await this.updateHealthIfNeeded()

    return response.result
  }

  async getNextRouteUserTx(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() })
    const url = `${this.#baseUrl}/route/build-next-tx?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to build next route user tx')

    response = await response.json()
    if (!response.success) throw new Error('Failed to build next route user tx')
    await this.updateHealthIfNeeded()

    return response.result
  }
}
