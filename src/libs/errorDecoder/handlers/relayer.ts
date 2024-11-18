/* eslint-disable class-methods-use-this */
import { isHexString } from 'ethers'

import { RELAYER_DOWN_MESSAGE } from '../../relayerCall/relayerCall'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class RelayerErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    const { message } = error || {}

    if (message === RELAYER_DOWN_MESSAGE) return true

    const hasRPCErrorSignatureInMessage =
      message?.includes('action=') && message?.includes('data=') && message?.includes('code=')

    return hasRPCErrorSignatureInMessage
  }

  public handle(data: string, error: any): DecodedError {
    let reason = ''
    let finalData = ''

    if (error.message === RELAYER_DOWN_MESSAGE) {
      // Relayer is down
      reason = RELAYER_DOWN_MESSAGE
    } else {
      // RPC error returned as string
      reason = error.message.match(/reason="([^"]*)"/)?.[1] || ''

      if (!reason || isHexString(reason)) {
        finalData = error.message.match(/data="([^"]*)"/)?.[1] || ''
        reason = ''
      }
    }

    return {
      type: ErrorType.RelayerError,
      reason,
      data: finalData
    }
  }
}

export default RelayerErrorHandler
