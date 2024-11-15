import { isHexString } from 'ethers'

class InnerCallFailureError extends Error {
  public data: string = ''

  constructor(message: string) {
    super(message)
    this.name = 'InnerCallFailureError'
    // If the message is a hex string pass it to
    // the data field so it can be used by other error handlers
    if (isHexString(message)) {
      this.data = message
    }
  }
}

export { InnerCallFailureError }
