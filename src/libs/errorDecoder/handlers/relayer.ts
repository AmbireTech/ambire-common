/* eslint-disable class-methods-use-this */
import { RELAYER_DOWN_MESSAGE } from '../../relayerCall/relayerCall'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class RelayerErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { message } = error || {}

    return message === RELAYER_DOWN_MESSAGE
  }

  public handle(data: string, error: any): DecodedError {
    // Make sure to add fallbacks and validate the message
    // if the matches() method's string comparison is not strict
    const reason = error.message

    return {
      type: ErrorType.RelayerError,
      reason,
      data: ''
    }
  }
}

export default RelayerErrorHandler
