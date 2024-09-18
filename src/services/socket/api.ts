import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'

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

  async getToTokenList({ fromChainId, toChainId }: { fromChainId: number; toChainId: number }) {
    const params = new URLSearchParams({
      fromChainId: fromChainId.toString(),
      toChainId: toChainId.toString()
    })
    const url = `${this.#baseUrl}/token-lists/to-token-list?${params.toString()}`

    let response = await this.#fetch(url, { headers: this.#headers })
    if (!response.ok) throw new Error('Failed to fetch token list')

    response = await response.json()
    if (!response.success) throw new Error('Failed to fetch token list')

    return response.result
  }
}
