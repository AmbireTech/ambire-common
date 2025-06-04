/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class UnknownWithMessageHandler implements ErrorHandler {
  message: string = ''

  public matches(data: string, error: any) {
    const itMatches = error instanceof Error && !!error.message
    if (itMatches) this.message = error.message
    return itMatches
  }

  public handle(data: string): DecodedError {
    return {
      type: ErrorType.UnknownWithMessage,
      reason: this.message,
      data
    }
  }
}

export default UnknownWithMessageHandler
