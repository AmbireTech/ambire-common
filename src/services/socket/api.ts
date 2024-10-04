import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import {
  SocketAPIQuote,
  SocketAPISendTransactionRequest,
  SocketAPIToken
} from '../../interfaces/swapAndBridge'
import {
  AMBIRE_FEE_TAKER_ADDRESSES,
  L2_ZERO_ADDRESS,
  NULL_ADDRESS,
  ZERO_ADDRESS
} from './constants'

/**
 * Socket API expects to receive null address instead of the zero address for
 * native tokens.
 */
export const normalizeNativeTokenAddressIfNeeded = (addr: string) =>
  [ZERO_ADDRESS, L2_ZERO_ADDRESS].includes(addr) ? NULL_ADDRESS : addr

export class SocketAPI {
  #fetch: Fetch

  #baseUrl = 'https://api.socket.tech/v2'

  #headers: RequestInitWithCustomHeaders['headers'] = {
    'API-KEY': process.env.SOCKET_API_KEY,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }

  constructor({ fetch }: { fetch: Fetch }) {
    this.#fetch = fetch
  }

  async getHealth() {
    try {
      // TODO: Figure out if we should do health check for Fund Movr API RPCs (getHealthRPC)
      let response = await this.#fetch(`${this.#baseUrl}/health`, { headers: this.#headers })
      if (!response.ok) return false

      response = await response.json()
      return response.ok
    } catch {
      return false
    }
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

    return response.result
  }

  async getFromTokenList({ fromChainId }: { fromChainId: number }) {
    const params = new URLSearchParams({
      fromChainId: fromChainId.toString()
    })
    const url = `${this.#baseUrl}/token-lists/from-token-list?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    const fallbackError = new Error('Failed to fetch from token list') // TODO: improve wording
    if (!response.ok) throw fallbackError

    response = await response.json()
    if (!response.success) throw fallbackError

    return response.result
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
      fromTokenAddress: normalizeNativeTokenAddressIfNeeded(fromTokenAddress),
      toChainId: toChainId.toString(),
      toTokenAddress: normalizeNativeTokenAddressIfNeeded(toTokenAddress),
      fromAmount: fromAmount.toString(),
      userAddress,
      // TODO: Figure out why passing this prop is causing error 500 in the API
      // feeTakerAddress: AMBIRE_FEE_TAKER_ADDRESSES[fromChainId],
      isContractCall: isSmartAccount.toString(), // only get quotes with that are compatible with contracts
      sort,
      singleTxOnly: 'false',
      defaultSwapSlippage: '1'
    })
    const url = `${this.#baseUrl}/quote?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to fetch quote')

    response = await response.json()
    if (!response.success) throw new Error('Failed to fetch quote')

    return response.result
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
    route: SocketAPIQuote['route']
  }) {
    const params = {
      fromChainId,
      toChainId,
      fromAssetAddress,
      toAssetAddress,
      includeFirstTxDetails: true,
      route
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

    return response.result
  }

  async getNextRouteUserTx(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']) {
    const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() })
    const url = `${this.#baseUrl}/route/build-next-tx?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to build next route user tx')

    response = await response.json()
    if (!response.success) throw new Error('Failed to build next route user tx')

    return response.result
  }
}
