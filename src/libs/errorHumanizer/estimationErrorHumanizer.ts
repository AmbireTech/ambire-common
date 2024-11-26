import EmittableError from '../../classes/EmittableError'
import { decodeError } from '../errorDecoder'
import { ESTIMATION_ERRORS } from './errors'
import { getHumanReadableErrorMessage } from './helpers'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

export const MESSAGE_PREFIX = 'The transaction cannot be estimated because'
const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.'

export function getHumanReadableEstimationError(e: Error) {
  if (e instanceof EmittableError) {
    return e
  }
  const decodedError = decodeError(e)
  const commonError = humanizeEstimationOrBroadcastError(decodedError.reason, MESSAGE_PREFIX)
  const errorMessage = getHumanReadableErrorMessage(
    commonError,
    ESTIMATION_ERRORS,
    MESSAGE_PREFIX,
    LAST_RESORT_ERROR_MESSAGE,
    decodedError.reason,
    e,
    decodedError.type
  )

  return new Error(errorMessage)
}
