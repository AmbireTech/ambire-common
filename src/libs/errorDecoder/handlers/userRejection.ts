/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

export const USER_REJECTED_TRANSACTION_ERROR_CODE = 4001
export const TRANSACTION_REJECTED_REASON = 'transaction-rejected'

class UserRejectionHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    return (
      !data &&
      (error?.message?.includes('rejected transaction') ||
        error?.code === USER_REJECTED_TRANSACTION_ERROR_CODE)
    )
  }

  public handle(data: string): DecodedError {
    return {
      type: ErrorType.UserRejectionError,
      reason: TRANSACTION_REJECTED_REASON,
      data
    }
  }
}

export default UserRejectionHandler
