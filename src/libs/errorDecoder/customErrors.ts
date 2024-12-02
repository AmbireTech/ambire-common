/* eslint-disable max-classes-per-file */
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

class RelayerPaymasterError extends Error {
  constructor(error: any) {
    const message = error.errorState ? error.errorState[0]?.message : ''
    super(message)
    this.name = 'PaymasterError'
    this.message = message
  }
}

export { InnerCallFailureError, RelayerPaymasterError }
