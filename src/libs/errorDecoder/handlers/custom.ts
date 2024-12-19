/* eslint-disable class-methods-use-this */
import { ERROR_PREFIX, PANIC_ERROR_PREFIX } from '../constants'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

/** Handles custom errors thrown by contracts */
class CustomErrorHandler implements ErrorHandler {
  public matches(data: string) {
    return (
      !!data &&
      data !== '0x' &&
      !data?.startsWith(ERROR_PREFIX) &&
      !data?.startsWith(PANIC_ERROR_PREFIX)
    )
  }

  public handle(data: string): DecodedError {
    return {
      type: ErrorType.CustomError,
      // Custom errors do not provide a specific reason.
      // Therefore, we return the raw data in hexadecimal format,
      // which can be used to map to a corresponding error message.
      reason: data,
      data
    }
  }
}

export default CustomErrorHandler
