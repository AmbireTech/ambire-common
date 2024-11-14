/* this file describes errors during estimation */
import { decodeError } from '../../errorDecoder'
import { EstimateResult } from '../interfaces'
import { getHumanReadableErrorMessage } from './helpers'

// TODO: Make other handlers. For example for broadcast errors
export function humanizeEstimationError(e: Error) {
  const decodedError = decodeError(e)
  const errorMessage = getHumanReadableErrorMessage(decodedError.reason, decodedError.type)

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
