import { BROADCAST_OR_ESTIMATION_ERRORS } from './errors'
import { getHumanReadableErrorMessage } from './helpers'

const humanizeEstimationOrBroadcastError = (
  reason: string | null,
  prefix: string,
  originalError: any
): string | null => {
  return getHumanReadableErrorMessage(
    null,
    BROADCAST_OR_ESTIMATION_ERRORS,
    prefix,
    reason,
    originalError
  )
}

export { humanizeEstimationOrBroadcastError }
