/* eslint-disable class-methods-use-this */
import { CANDIDE } from '../../../consts/bundlers'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class CandideEstimationErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { bundlerName } = error

    return bundlerName && bundlerName === CANDIDE
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public handle(data: string, error: any): DecodedError {
    const { message } = error?.error || error || {}
    const lowerCased = typeof message === 'string' ? message.toLowerCase() : ''

    let reason = ''
    if (lowerCased.includes('internal error')) {
      reason = 'candide: 500'
    }

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default CandideEstimationErrorHandler
