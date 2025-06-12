export default class SwapAndBridgeProviderApiError extends Error {
  shortMessage?: string

  constructor(message: string, shortMessage?: string) {
    super()
    this.name = 'SwapAndBridgeProviderApiError'
    this.message = message
    this.shortMessage = shortMessage
  }
}
