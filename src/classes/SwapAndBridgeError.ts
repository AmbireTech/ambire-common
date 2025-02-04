export default class SwapAndBridgeError extends Error {
  constructor(message: string) {
    super()
    this.name = 'SwapAndBridgeError'
    this.message = message
  }
}
