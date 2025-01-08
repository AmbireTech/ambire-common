/* eslint-disable class-methods-use-this */
import { BICONOMY } from '../../../consts/bundlers'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class BiconomyEstimationErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { bundlerName } = error

    return bundlerName && bundlerName === BICONOMY
  }

  public handle(data: string, error: any): DecodedError {
    const { message } = error?.error || error || {}

    // TODO: expand with more error cases
    let reason = ''
    if (message.includes('server response 400 Bad Request')) {
      reason = 'user operation validation failed'
    }

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default BiconomyEstimationErrorHandler
