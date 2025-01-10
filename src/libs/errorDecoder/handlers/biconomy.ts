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
    const lowerCased = message.toLowerCase()

    // TODO: expand with more error cases
    let reason = ''
    if (lowerCased.includes('400 bad request') || lowerCased.includes('internal error')) {
      reason = 'biconomy: 400'
    }

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default BiconomyEstimationErrorHandler
