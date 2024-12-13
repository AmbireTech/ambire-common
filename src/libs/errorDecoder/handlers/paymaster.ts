/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class PaymasterErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { name } = error

    return name === 'PaymasterError' || name === 'PaymasterSponsorshipError'
  }

  public handle(data: string, error: any): DecodedError {
    const { message: reason } = error

    return {
      type: ErrorType.PaymasterError,
      reason,
      data: ''
    }
  }
}

export default PaymasterErrorHandler
