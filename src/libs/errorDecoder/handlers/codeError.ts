/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

/** Handles custom errors thrown by contracts */
class CodeErrorHandler implements ErrorHandler {
  public matches(data: string, error: Error) {
    return (
      error instanceof TypeError ||
      error instanceof ReferenceError ||
      error instanceof SyntaxError ||
      error instanceof RangeError
    )
  }

  public handle(data: string, error: Error): DecodedError {
    console.error('Encountered a code error', error)

    const NETWORK_FETCH_ERRORS = [
      'NetworkError',
      'FetchError',
      'Failed to fetch',
      'Network request failed',
      'Failed to load resource'
    ]
    const message = error.message || ''
    let reason = error.name

    if (error.cause) {
      reason = `${reason}: ${error.cause}`
    }

    // Specific errors we want format and push to the user
    if (
      NETWORK_FETCH_ERRORS.some((networkErrorMessage) =>
        message.toLowerCase().includes(networkErrorMessage.toLowerCase())
      )
    ) {
      reason = 'NetworkError'
    }

    return {
      type: ErrorType.CodeError,
      reason,
      data: null
    }
  }
}

export default CodeErrorHandler
