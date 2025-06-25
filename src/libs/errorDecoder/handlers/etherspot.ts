/* eslint-disable class-methods-use-this */
import { ETHERSPOT } from '../../../consts/bundlers'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class EtherspotEstimationErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { bundlerName } = error

    return bundlerName && bundlerName === ETHERSPOT
  }

  public handle(data: string, error: any): DecodedError {
    const { message } = error?.error || error || {}
    const lowerCased = typeof message === 'string' ? message.toLowerCase() : ''

    // TODO: expand with more error cases
    let reason = ''
    if (lowerCased.includes('internal error')) {
      reason = 'etherspot: 500'
    }

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default EtherspotEstimationErrorHandler
