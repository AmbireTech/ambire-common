import { EstimateResult } from './interfaces'

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
