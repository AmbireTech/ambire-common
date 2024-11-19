/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class BundlerErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { message } = error?.error || error || {}

    return (
      message.includes('UserOperation reverted during simulation with reason:') ||
      message.includes('pimlico_getUserOperationGasPrice')
    )
  }

  public handle(data: string, error: any): DecodedError {
    const userOperationRevertedRegex = /UserOperation reverted during simulation with reason:\s*/i
    const { message } = error?.error || error || {}
    let reason = ''

    if (userOperationRevertedRegex.test(message)) {
      const EntryPointErrorCode = /AA[0-9]{1,2}\s?/
      reason = message.replace(userOperationRevertedRegex, '')
      // Remove error codes like AA1, AA2, etc. and the space after them
      reason = reason.replace(EntryPointErrorCode, '')
    } else if (message.includes('pimlico_getUserOperationGasPrice')) {
      reason = 'pimlico_getUserOperationGasPrice'
    }

    return {
      type: ErrorType.BundlerError,
      reason,
      data: reason
    }
  }
}

export default BundlerErrorHandler
