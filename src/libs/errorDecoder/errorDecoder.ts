import {
  BundlerAndPaymasterErrorHandler,
  InnerCallFailureHandler,
  PanicErrorHandler,
  RevertErrorHandler,
  RpcErrorHandler
} from './handlers'
import { getDataFromError, isReasonValid } from './helpers'
import { DecodedError, ErrorType } from './types'

const ERROR_HANDLERS = [
  PanicErrorHandler,
  RpcErrorHandler,
  InnerCallFailureHandler,
  BundlerAndPaymasterErrorHandler,
  RevertErrorHandler
]

export function decodeError(e: Error): DecodedError {
  const errorData = getDataFromError(e)

  let decodedError: DecodedError = {
    type: ErrorType.UnknownError,
    reason: '',
    data: errorData
  }

  ERROR_HANDLERS.forEach((HandlerClass) => {
    const handler = new HandlerClass()
    const hasAlreadyBeenHandled =
      decodedError.type !== ErrorType.UnknownError && isReasonValid(decodedError.reason)

    if (handler.matches(errorData, e) && !hasAlreadyBeenHandled) {
      decodedError = handler.handle(errorData, e)
    }
  })

  return decodedError
}
