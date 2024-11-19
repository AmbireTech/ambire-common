/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class BundlerErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { message } = error?.error || error || {}

    return message.includes('UserOperation reverted during simulation with reason:')
  }

  public handle(data: string, error: any): DecodedError {
    const { message } = error?.error || error || {}
    const reason = message.replace(/UserOperation reverted during simulation with reason:\s*/i, '')

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default BundlerErrorHandler
