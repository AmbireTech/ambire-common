import { decodeError } from '../errorDecoder'
import { CONTRACT_ERRORS } from '../errorDecoder/constants'
import { getErrorCodeStringFromReason } from '../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../errorDecoder/types'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.'
export const MESSAGE_PREFIX = 'The transaction cannot be estimated because'

function getGenericMessageFromType(errorType: ErrorType, reason: DecodedError['reason']): string {
  const reasonString = getErrorCodeStringFromReason(reason ?? '')

  switch (errorType) {
    case ErrorType.RelayerError:
      return `${MESSAGE_PREFIX} the Ambire relayer is down. Please try again later, broadcast with a Basic Account or contact Ambire support for assistance.`
    case ErrorType.RpcError:
      return `${MESSAGE_PREFIX} of an RPC error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.PanicError:
      return `${MESSAGE_PREFIX} of a panic error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.BundlerAndPaymasterError:
      return `${MESSAGE_PREFIX} of a Bundler/Paymaster error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.UnknownError:
      return `${MESSAGE_PREFIX} of an unknown error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.InnerCallFailureError:
      return `${MESSAGE_PREFIX} of a failure while validating the transaction. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.RevertError:
      return `${MESSAGE_PREFIX} of a revert error. Please try again or contact Ambire support for assistance.${reasonString}`
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
    case 'SPOOF_ERROR':
    case 'INSUFFICIENT_PRIVILEGE':
      return `${MESSAGE_PREFIX} your account key lacks the necessary permissions. Ensure that you have authorization to sign or use an account with sufficient privileges.`
    default:
      if (CONTRACT_ERRORS.find((contractMsg) => reason?.includes(contractMsg)))
        return `${MESSAGE_PREFIX} because this dApp does not support Smart Account wallets. Please use a Basic Account (EOA) to interact with this dApp.`

      return getGenericMessageFromType(errorType, reason)
  }
}

export function getHumanReadableEstimationError(e: Error) {
  const decodedError = decodeError(e)
  const errorMessage = getHumanReadableErrorMessage(decodedError.reason, decodedError.type)

  return new Error(errorMessage)
}
