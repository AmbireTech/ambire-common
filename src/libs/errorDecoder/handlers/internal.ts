/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

const CONNECTIVITY_REASONS = ['Failed to fetch', 'NetworkError', 'Failed to load']

class InternalHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    return (
      error instanceof TypeError ||
      error instanceof ReferenceError ||
      error instanceof SyntaxError ||
      error instanceof RangeError
    )
  }

  public handle(data: string, error: any): DecodedError {
    const isConnectivityError = CONNECTIVITY_REASONS.some((reason) =>
      error.message?.includes(reason)
    )

    if (isConnectivityError) {
      return {
        type: ErrorType.ConnectivityError,
        reason: 'ConnectivityError',
        data: error.message
      }
    }

    return {
      type: ErrorType.CodeError,
      reason: error.name,
      data
    }
  }
}

export default InternalHandler
