/* eslint-disable class-methods-use-this */
import { ETHERSPOT } from '../../../consts/bundlers'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class EtherspotEstimationErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { bundlerName } = error

    return bundlerName && bundlerName === ETHERSPOT
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public handle(data: string, error: any): DecodedError {
    // etherspot have multiple problems:
    // - our deploys don't work as state override is not supported
    // - our delegations don't work as state override is not supported
    // - on enormous usage, we can hit the rate limit
    // so we always "notify" the code to switch to another
    // bundler and continue the execution no matter what the error is.
    // This is the safest way to use etherspot atm
    const reason = 'etherspot: 500'
    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default EtherspotEstimationErrorHandler
