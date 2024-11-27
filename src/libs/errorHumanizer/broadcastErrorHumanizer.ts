import EmittableError from '../../classes/EmittableError'
import ExternalSignerError from '../../classes/ExternalSignerError'
import { decodeError } from '../errorDecoder'
import { BROADCAST_ERRORS } from './errors'
import { getHumanReadableErrorMessage } from './helpers'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while broadcasting the transaction. Please try again or contact Ambire support for assistance.'
const MESSAGE_PREFIX = 'The transaction cannot be broadcast because'

export function getHumanReadableBroadcastError(e: Error) {
  if (e instanceof EmittableError || e instanceof ExternalSignerError) {
    return e
  }
  const decodedError = decodeError(e)
  const commonError = humanizeEstimationOrBroadcastError(decodedError.reason, MESSAGE_PREFIX)
  const errorMessage = getHumanReadableErrorMessage(
    commonError,
    BROADCAST_ERRORS,
    MESSAGE_PREFIX,
    LAST_RESORT_ERROR_MESSAGE,
    decodedError.reason,
    e,
    decodedError.type
  )

  return new Error(errorMessage)
}
