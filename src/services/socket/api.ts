export class Socket {
  #apiKey: string

  constructor(apiKey: string) {
    this.#apiKey = apiKey
  }

  /**
   * Include these headers into each requets
   *
   * @returns json
   */
  #getHeaders() {
    return {
      'API-KEY': this.#apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  }
}
