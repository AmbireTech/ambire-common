import EmittableError from '../../classes/EmittableError'
import ExternalSignerError from '../../classes/ExternalSignerError'
import { decodeError } from '../errorDecoder'
import { DecodedError } from '../errorDecoder/types'
import { ESTIMATION_ERRORS } from './errors'
import { getGenericMessageFromType, getHumanReadableErrorMessage } from './helpers'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

export const MESSAGE_PREFIX = 'The transaction will fail because'

const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.'

export function getHumanReadableEstimationError(e: Error | DecodedError) {
  // These errors should be thrown as they are
  // as they are already human-readable
  if (e instanceof EmittableError || e instanceof ExternalSignerError) {
    return e
  }
  const decodedError = e instanceof Error ? decodeError(e as Error) : (e as DecodedError)
  const commonError = humanizeEstimationOrBroadcastError(decodedError.reason, MESSAGE_PREFIX)
  let errorMessage = getHumanReadableErrorMessage(
    commonError,
    ESTIMATION_ERRORS,
    MESSAGE_PREFIX,
    decodedError.reason,
    e
  )

  if (!errorMessage) {
    errorMessage = getGenericMessageFromType(
      decodedError.type,
      decodedError.reason,
      MESSAGE_PREFIX,
      LAST_RESORT_ERROR_MESSAGE
    )
  }

  return new Error(errorMessage)
}
