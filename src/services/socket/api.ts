import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import { AMBIRE_FEE_TAKER_ADDRESSES, NULL_ADDRESS, ZERO_ADDRESS } from './constants'

/**
 * Socket API expects to receive null address instead of the zero address for
 * native tokens.
 */
const normalizeNativeTokenAddressIfNeeded = (addr: string) =>
  addr === ZERO_ADDRESS ? NULL_ADDRESS : addr

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

  async getToTokenList({ fromChainId, toChainId }: { fromChainId: number; toChainId: number }) {
    const params = new URLSearchParams({
      fromChainId: fromChainId.toString(),
      toChainId: toChainId.toString()
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
    isSmartAccount
  }: {
    fromChainId: number
    fromTokenAddress: string
    toChainId: number
    toTokenAddress: string
    fromAmount: string
    userAddress: string
    isSmartAccount: boolean
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
      // TODO: To be discussed if we should allow user to change any of these below:
      sort: 'time',
      uniqueRoutesPerBridge: 'true', // return only best route per bridge using the sort criteria
      defaultSwapSlippage: '0.5',
      defaultBridgeSlippage: '0.5'
    })
    const url = `${this.#baseUrl}/quote?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to fetch quote')

    response = await response.json()
    if (!response.success) throw new Error('Failed to fetch quote')

    return response.result
  }
}
