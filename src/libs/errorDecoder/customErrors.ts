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
    let message = ''
    if (error.errorState && error.errorState[0]) {
      message = error.errorState[0].message
    } else if (error.message) {
      message = error.message
    }

    super(message)
    this.name = 'PaymasterError'
    this.message = message
  }
}

class SponsorshipPaymasterError extends Error {
  constructor() {
    const message = 'Sponsorship failed.'
    super(message)
    this.name = 'PaymasterSponsorshipError'
    this.message = message
  }
}

export { InnerCallFailureError, RelayerPaymasterError, SponsorshipPaymasterError }
