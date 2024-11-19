/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class BundlerGasPriceHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { message } = error?.error || error || {}

    return message.includes('pimlico_getUserOperationGasPrice')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public handle(data: string, error: any): DecodedError {
    const reason = 'pimlico_getUserOperationGasPrice'

    return {
      type: ErrorType.BundlerGasPriceError,
      reason,
      data: reason
    }
  }
}

export default BundlerGasPriceHandler
