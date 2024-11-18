import { decodeError } from '../errorDecoder'
import { getErrorCodeStringFromReason } from '../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../errorDecoder/types'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while broadcasting the transaction. Please try again or contact Ambire support for assistance.'
const MESSAGE_PREFIX = 'The transaction cannot be broadcasted'

function getGenericMessageFromType(errorType: ErrorType, reason: DecodedError['reason']): string {
  const reasonString = getErrorCodeStringFromReason(reason ?? '')

  switch (errorType) {
    case ErrorType.RelayerError:
      return `${MESSAGE_PREFIX} the Ambire relayer is down. Please try again later, broadcast with a Basic Account or contact Ambire support for assistance.`
    case ErrorType.RpcError:
      return `${MESSAGE_PREFIX} of an RPC error. Please try again or contact Ambire support for assistance. ${reasonString}`
    case ErrorType.PanicError:
      return `${MESSAGE_PREFIX} of a panic error. Please try again or contact Ambire support for assistance. ${reasonString}`
    case ErrorType.BundlerAndPaymasterError:
      return `${MESSAGE_PREFIX} of a Bundler/Paymaster error. Please try again or contact Ambire support for assistance. ${reasonString}`
    case ErrorType.UnknownError:
      return `${MESSAGE_PREFIX} of an unknown error. Please try again or contact Ambire support for assistance. ${reasonString}`
    case ErrorType.InnerCallFailureError:
      return `${MESSAGE_PREFIX} of a failure while validating the transaction. Please try again or contact Ambire support for assistance. ${reasonString}`
    case ErrorType.RevertError:
      return `${MESSAGE_PREFIX} of a revert error. Please try again or contact Ambire support for assistance. ${reasonString}`
    default:
      return LAST_RESORT_ERROR_MESSAGE
  }
}

const getHumanReadableErrorMessage = (
  reason: DecodedError['reason'],
  errorType: DecodedError['type']
) => {
  const commonError = humanizeEstimationOrBroadcastError(reason, MESSAGE_PREFIX)

  if (commonError) return commonError

  switch (reason) {
    // This will most likely not match as the reason should
    // be something like 'fee too low'
    case 'pimlico_getUserOperationGasPrice':
      return `${MESSAGE_PREFIX} the selected fee is too low. Please select a higher transaction speed and try again.`
    default:
      return getGenericMessageFromType(errorType, reason)
  }
}

export function getHumanReadableBroadcastError(e: Error) {
  const decodedError = decodeError(e)
  const errorMessage = getHumanReadableErrorMessage(decodedError.reason, decodedError.type)

  return new Error(errorMessage)
}
