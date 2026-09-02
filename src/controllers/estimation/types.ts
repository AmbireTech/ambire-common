export enum EstimationStatus {
  Initial = 'initial',
  Error = 'error',
  Loading = 'loading',
  Success = 'success'
}

/** What asking again could do about the reason the last attempt failed. */
export enum EstimationFailureKind {
  /**
   * Nothing was reached, but a later attempt may be. The reestimation loop
   * keeps going and the sign screen says it is taking longer than usual.
   */
  Retriable = 'retriable',
  /** Asking again cannot change the outcome, so the loop stops. */
  Permanent = 'permanent'
}
