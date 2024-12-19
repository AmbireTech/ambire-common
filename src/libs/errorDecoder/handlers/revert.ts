/* eslint-disable class-methods-use-this */
import { AbiCoder, ErrorFragment } from 'ethers'

import { ERROR_PREFIX } from '../constants'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class RevertErrorHandler implements ErrorHandler {
  public matches(data: string): boolean {
    return data?.startsWith(ERROR_PREFIX)
  }

  public handle(data: string): DecodedError {
    const encodedReason = data.slice(ERROR_PREFIX.length)
    const abi = new AbiCoder()
    try {
      const fragment = ErrorFragment.from('Error(string)')
      const args = abi.decode(fragment.inputs, `0x${encodedReason}`)
      const reason = args[0] as string

      return {
        type: ErrorType.RevertError,
        reason,
        data
      }
    } catch (e) {
      console.error('Failed to decode revert error', e)

      return {
        type: ErrorType.RevertError,
        reason: '',
        data
      }
    }
  }
}

export default RevertErrorHandler
