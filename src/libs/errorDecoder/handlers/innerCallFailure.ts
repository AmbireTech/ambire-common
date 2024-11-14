/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class InnerCallFailureHandler implements ErrorHandler {
  public matches(data: string, error: Error) {
    return error.name === 'InnerCallFailureError'
  }

  public handle(data: string, error: Error): DecodedError {
    const reason = error.message

    return {
      type: ErrorType.InnerCallFailureError,
      reason,
      data
    }
  }
}

export default InnerCallFailureHandler
