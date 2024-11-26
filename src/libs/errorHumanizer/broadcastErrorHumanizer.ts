import EmittableError from '../../classes/EmittableError'
import { decodeError } from '../errorDecoder'
import { getHumanReadableErrorMessage } from './helpers'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while broadcasting the transaction. Please try again or contact Ambire support for assistance.'
const MESSAGE_PREFIX = 'The transaction cannot be broadcast because'
const ERRORS: {
  [key: string]: string
} = {
  pimlico_getUserOperationGasPrice:
    'the selected fee is too low. Please select a higher transaction speed and try again.'
}

export function getHumanReadableBroadcastError(e: Error) {
  if (e instanceof EmittableError) {
    return e
  }
  const decodedError = decodeError(e)
  const commonError = humanizeEstimationOrBroadcastError(decodedError.reason, MESSAGE_PREFIX)
  const errorMessage = getHumanReadableErrorMessage(
    commonError,
    ERRORS,
    MESSAGE_PREFIX,
    LAST_RESORT_ERROR_MESSAGE,
    decodedError.reason,
    e,
    decodedError.type
  )

  return new Error(errorMessage)
}
