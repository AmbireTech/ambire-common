/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class HardwareWalletRejected implements ErrorHandler {
  public matches(data: string, error: Error) {
    return error.message.includes('Rejected by your')
  }

  public handle(data: string, error: Error): DecodedError {
    const reason = error.message

    return {
      type: ErrorType.HardwareWalletRejectedError,
      reason,
      data: reason
    }
  }
}

export default HardwareWalletRejected
