import EmittableError from '../../classes/EmittableError'
import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { decodeError } from '../errorDecoder'
import { DecodedError } from '../errorDecoder/types'
import { getGenericMessageFromType, getHumanReadableErrorMessage } from '../errorHumanizer/helpers'

// TODO:
export const MESSAGE_PREFIX = 'There was a problem because'

// TODO:
const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred. Please try again or contact Ambire support for assistance.'

export function getHumanReadableSwapAndBridgeError(e: Error | DecodedError) {
  // These errors should be thrown as they are
  // as they are already human-readable
  if (e instanceof EmittableError || e instanceof SwapAndBridgeProviderApiError) {
    return e
  }

  const decodedError = e instanceof Error ? decodeError(e as Error) : (e as DecodedError)
  // Do I need ?getHumanReadableErrorMessage
  let errorMessage = getHumanReadableErrorMessage(
    e?.message || '', // TODO commonError?,
    [], // ESTIMATION_ERRORS
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

  return new Error(errorMessage, { cause: decodedError.reason })
}
