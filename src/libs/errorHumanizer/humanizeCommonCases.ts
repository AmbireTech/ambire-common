import { DecodedError } from '../errorDecoder/types'
import { BROADCAST_OR_ESTIMATION_ERRORS } from './errors'
import { getHumanReadableErrorMessage } from './helpers'

const humanizeEstimationOrBroadcastError = (
  decodedError: DecodedError,
  prefix: string,
  originalError: any
): string | null => {
  return getHumanReadableErrorMessage(
    null,
    BROADCAST_OR_ESTIMATION_ERRORS,
    prefix,
    decodedError,
    originalError
  )
}

export { humanizeEstimationOrBroadcastError }
