import EmittableError from '../../classes/EmittableError'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'

export function getHumanReadableSwapAndBridgeError(
  e: EmittableError | SwapAndBridgeProviderApiError | SwapAndBridgeError | Error | any
) {
  // These errors should be thrown as they are
  // as they are already human-readable
  if (
    e instanceof EmittableError ||
    e instanceof SwapAndBridgeProviderApiError ||
    e instanceof SwapAndBridgeError
  ) {
    return e
  }

  // Last resort (fallback) error handling
  const message = e?.message || 'no details'
  const errorMessage = `Unexpected error happened in the Swap & Bridge flow. Try again later or contact Ambire support. Details: <${message}>`

  return new Error(errorMessage)
}
