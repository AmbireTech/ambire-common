import EmittableError from '../../classes/EmittableError'
import ExternalSignerError from '../../classes/ExternalSignerError'
import { decodeError } from '../errorDecoder'
import { DecodedError, ErrorType } from '../errorDecoder/types'
import { BROADCAST_ERRORS } from './errors'
import { getGenericMessageFromType, getHumanReadableErrorMessage } from './helpers'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while broadcasting the transaction. Please try again or contact Ambire support for assistance.'
const MESSAGE_PREFIX = 'The transaction cannot be broadcast because'
/** The paymaster is down or the user is offline */
export const PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE =
  'Unable to connect to the paymaster. Please try again'

function getPrefix(reason: string | null): string {
  if (!reason) return MESSAGE_PREFIX
  return !reason.includes('pimlico: 500') ? MESSAGE_PREFIX : ''
}

export function getHumanReadableBroadcastError(e: Error | DecodedError) {
  if (e instanceof EmittableError || e instanceof ExternalSignerError) {
    return e
  }

  const decodedError = e instanceof Error ? decodeError(e as Error) : (e as DecodedError)
  const commonError = humanizeEstimationOrBroadcastError(
    decodedError.reason,
    getPrefix(decodedError.reason),
    e
  )
  let errorMessage = getHumanReadableErrorMessage(
    commonError,
    BROADCAST_ERRORS,
    MESSAGE_PREFIX,
    decodedError.reason,
    e
  )

  if (!errorMessage) {
    if (decodedError.type === ErrorType.PaymasterError) {
      errorMessage = PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE
    } else {
      errorMessage = getGenericMessageFromType(
        decodedError.type,
        decodedError.reason,
        MESSAGE_PREFIX,
        LAST_RESORT_ERROR_MESSAGE
      )
    }
  }

  return new Error(errorMessage, { cause: decodedError.reason })
}
