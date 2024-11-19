import { decodeError } from '../errorDecoder'
import { DecodedError } from '../errorDecoder/types'
import {
  getGenericMessageFromType,
  humanizeEstimationOrBroadcastError
} from './humanizeCommonCases'

const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while broadcasting the transaction. Please try again or contact Ambire support for assistance.'
const MESSAGE_PREFIX = 'The transaction cannot be broadcast'

const getHumanReadableErrorMessage = (
  reason: DecodedError['reason'],
  errorType: DecodedError['type']
) => {
  const commonError = humanizeEstimationOrBroadcastError(reason, MESSAGE_PREFIX)

  if (commonError) return commonError

  switch (reason) {
    default:
      return getGenericMessageFromType(errorType, reason, MESSAGE_PREFIX, LAST_RESORT_ERROR_MESSAGE)
  }
}

export function getHumanReadableBroadcastError(e: Error) {
  const decodedError = decodeError(e)
  const errorMessage = getHumanReadableErrorMessage(decodedError.reason, decodedError.type)

  return new Error(errorMessage)
}
