/* eslint-disable class-methods-use-this */
import { AbiCoder, ErrorFragment } from 'ethers'

import { PANIC_ERROR_PREFIX } from '../constants'
import { panicErrorCodeToReason } from '../helpers'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class PanicErrorHandler implements ErrorHandler {
  public matches(data: string): boolean {
    return data?.startsWith(PANIC_ERROR_PREFIX)
  }

  public handle(data: string): DecodedError {
    const encodedReason = data.slice(PANIC_ERROR_PREFIX.length)
    const abi = new AbiCoder()
    try {
      const fragment = ErrorFragment.from('Panic(uint256)')
      const args = abi.decode(fragment.inputs, `0x${encodedReason}`)
      const reason = panicErrorCodeToReason(args[0] as bigint) ?? 'Unknown panic code'

      return {
        type: ErrorType.PanicError,
        reason,
        data
      }
    } catch (e) {
      console.error('Failed to decode panic error', e)
      return {
        type: ErrorType.PanicError,
        reason: 'Failed to decode panic error',
        data
      }
    }
  }
}

export default PanicErrorHandler
