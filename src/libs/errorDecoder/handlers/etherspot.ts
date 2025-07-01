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
    // the exact bundler errors are irrelevant as the ambire estimation returns
    // the message. We just indicate here that the bundler switcher should
    // switch to the next available bundler
    const reason = 'etherspot: 500'
    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default EtherspotEstimationErrorHandler
