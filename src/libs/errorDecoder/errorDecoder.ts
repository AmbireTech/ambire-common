import {
  BundlerErrorHandler,
  CustomErrorHandler,
  InnerCallFailureHandler,
  PanicErrorHandler,
  PaymasterErrorHandler,
  RevertErrorHandler,
  RpcErrorHandler,
  UserRejectionHandler
} from './handlers'
import InternalHandler from './handlers/internal'
import RelayerErrorHandler from './handlers/relayer'
import { formatReason, getDataFromError, isReasonValid } from './helpers'
import { DecodedError, ErrorType } from './types'

const PREPROCESSOR_HANDLERS = [BundlerErrorHandler, RelayerErrorHandler, InnerCallFailureHandler]
const ERROR_HANDLERS = [
  InternalHandler,
  RpcErrorHandler,
  CustomErrorHandler,
  PanicErrorHandler,
  RevertErrorHandler,
  PaymasterErrorHandler,
  UserRejectionHandler
]

// additionalHandlers is a list of handlers we want to add only for
// specific decodeError cases (e.g. bundler estimation)
export function decodeError(e: Error): DecodedError {
  const errorData = getDataFromError(e)

  let decodedError: DecodedError = {
    type: ErrorType.UnknownError,
    reason: '',
    data: errorData
  }

  // Run preprocessor handlers first
  // The idea is that preprocessor handlers can either decode the error
  // or leave it partially decoded for the other handlers to decode
  PREPROCESSOR_HANDLERS.forEach((HandlerClass) => {
    const handler = new HandlerClass()
    if (handler.matches(errorData, e)) {
      decodedError = handler.handle(errorData, e)
    }
  })

  // Run error handlers
  ERROR_HANDLERS.forEach((HandlerClass) => {
    const handler = new HandlerClass()
    const isValidReason = isReasonValid(decodedError.reason)
    const processedData = decodedError.data || errorData

    if (handler.matches(processedData, e) && !isValidReason) {
      decodedError = handler.handle(processedData, e)
    }
  })

  decodedError.reason = formatReason(decodedError.reason || '')

  if (decodedError.type === ErrorType.UnknownError) {
    console.error('Failed to decode error', e)
  }

  return decodedError
}
