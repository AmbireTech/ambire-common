export default class ExternalSignerError extends Error {
  constructor(message: string) {
    super()
    this.name = 'ExternalSignerError'
    this.message = message
  }
}
