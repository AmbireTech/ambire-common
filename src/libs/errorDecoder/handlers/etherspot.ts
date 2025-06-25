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

    let reason = ''
    if (
      lowerCased.includes('internal error') ||
      // etherspot don't support state override and therefore they cannot
      // estimate our deploy transaction. That's why we scan for a aa20
      // error and when encountered, fallback to another bundler
      lowerCased.includes('aa20')
    ) {
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
