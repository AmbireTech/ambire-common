/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class BundlerErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { message } = error?.error || error || {}

    return (
      message.includes('UserOperation reverted during simulation') ||
      message.includes('pimlico_getUserOperationGasPrice') ||
      message.includes('UserOperation failed validation') ||
      message.includes('UserOperation reverted') ||
      message.includes('invalid account nonce')
    )
  }

  public handle(data: string, error: any): DecodedError {
    const { message } = error?.error || error || {}
    let reason = ''

    if (message.includes('pimlico_getUserOperationGasPrice')) {
      reason = 'pimlico_getUserOperationGasPrice'
    } else {
      const EntryPointErrorCode = /AA[0-9]{1,2}\s?/
      // Remove error codes like AA1, AA2, etc. and the space after them
      reason = reason.replace(EntryPointErrorCode, '')
    }

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default BundlerErrorHandler
