/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class BiconomyEstimationErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { message } = error?.error || error || {}

    // TODO: expand with more error cases
    return message.includes('server response 400 Bad Request')
  }

  public handle(data: string, error: any): DecodedError {
    const { message } = error?.error || error || {}

    // TODO: expand with more error cases
    let reason = ''
    if (message.includes('server response 400 Bad Request')) {
      reason = 'transfer amount exceeds balance'
    }

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default BiconomyEstimationErrorHandler
