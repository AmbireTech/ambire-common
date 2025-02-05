export default class SwapAndBridgeProviderApiError extends Error {
  constructor(message: string) {
    super()
    this.name = 'SwapAndBridgeProviderApiError'
    this.message = message
  }
}
