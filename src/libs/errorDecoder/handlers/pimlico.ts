/* eslint-disable class-methods-use-this */
import { PIMLICO } from '../../../consts/bundlers'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class PimlicoEstimationErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { bundlerName } = error

    return bundlerName && bundlerName === PIMLICO
  }

  public handle(data: string, error: any): DecodedError {
    const { message } = error?.error || error || {}

    // TODO: expand with more error cases
    let reason = ''
    if (message.includes('Internal error from bundler')) {
      reason = 'pimlico: 500'
    }

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default PimlicoEstimationErrorHandler
