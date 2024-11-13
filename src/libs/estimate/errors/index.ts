/* this file describes errors during estimation */
import { EstimateResult } from '../interfaces'
import {
  BundlerAndPaymasterErrorHandler,
  InnerCallFailureHandler,
  PanicErrorHandler,
  RevertErrorHandler,
  RpcErrorHandler
} from './errorHandlers'
import { getDataFromError, getHumanReadableErrorMessage, isReasonValid } from './helpers'
import { DecodedError, ErrorType } from './types'

const ERROR_HANDLERS = [
  PanicErrorHandler,
  RpcErrorHandler,
  InnerCallFailureHandler,
  BundlerAndPaymasterErrorHandler,
  RevertErrorHandler
]

export function catchEstimationFailure(e: Error) {
  let decodedError: DecodedError = {
    type: ErrorType.UnknownError,
    reason: 'Unknown error',
    data: ''
  }
  const errorData = getDataFromError(e)
  console.log('catchEstimationFailure og:', e, { errorData, ...e })

  ERROR_HANDLERS.forEach((HandlerClass) => {
    const handler = new HandlerClass()
    const hasAlreadyBeenHandled =
      decodedError.type !== ErrorType.UnknownError && isReasonValid(decodedError.reason)

    if (handler.matches(errorData, e) && !hasAlreadyBeenHandled) {
      console.log({
        oldDecodedError: decodedError,
        newDecodedError: handler.handle(errorData, e),
        handlerName: handler.constructor.name
      })
      decodedError = handler.handle(errorData, e)
    }
  })

  const errorMessage = getHumanReadableErrorMessage(decodedError.reason, decodedError.type)
  console.log('parsed error:', errorMessage)

  return new Error(errorMessage)
}

export function estimationErrorFormatted(
  error: Error,
  opts?: {
    feePaymentOptions?: EstimateResult['feePaymentOptions']
    nonFatalErrors?: Error[]
  }
): EstimateResult {
  const feePaymentOptions = opts?.feePaymentOptions ?? []
  const finalsOps = {
    ...opts,
    feePaymentOptions,
    nonFatalErrors: opts?.nonFatalErrors ?? undefined
  }

  return {
    gasUsed: 0n,
    currentAccountNonce: 0,
    error,
    ...finalsOps
  }
}
