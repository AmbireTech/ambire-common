import { BundlerError } from './customErrors'
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
import BiconomyEstimationErrorHandler from './handlers/biconomy'
import PimlicoEstimationErrorHandler from './handlers/pimlico'
import RelayerErrorHandler from './handlers/relayer'
import { formatReason, getDataFromError, isReasonValid } from './helpers'
import { DecodedError, ErrorType } from './types'

const PREPROCESSOR_BUNDLER_HANDLERS = [
  BiconomyEstimationErrorHandler,
  PimlicoEstimationErrorHandler
]

const PREPROCESSOR_HANDLERS = [BundlerErrorHandler, RelayerErrorHandler, InnerCallFailureHandler]
const ERROR_HANDLERS = [
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
  // Otherwise regular JS/TS errors will be handled
  // as RPC errors which is confusing.
  if (
    e instanceof TypeError ||
    e instanceof ReferenceError ||
    e instanceof SyntaxError ||
    e instanceof RangeError
  ) {
    console.error('Encountered a code error', e)

    return {
      type: ErrorType.CodeError,
      reason: e.name,
      data: null
    }
  }

  const errorData = getDataFromError(e)

  let decodedError: DecodedError = {
    type: ErrorType.UnknownError,
    reason: '',
    data: errorData
  }

  // configure a list of preprocessorHandlers we want to use.
  // There are very generic errors like 400 bad request that when they come
  // from a bundler that mean one thing but from an RPC another, and from the relayer
  // a third. So we will add additional handlers optionally
  const preprocessorHandlers = PREPROCESSOR_HANDLERS
  if (e instanceof BundlerError) {
    preprocessorHandlers.push(...PREPROCESSOR_BUNDLER_HANDLERS)
  }

  // Run preprocessor handlers first
  // The idea is that preprocessor handlers can either decode the error
  // or leave it partially decoded for the other handlers to decode
  preprocessorHandlers.forEach((HandlerClass) => {
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
