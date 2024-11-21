import { decodeError } from '../errorDecoder'
import { CONTRACT_ERRORS } from '../errorDecoder/constants'
import { DecodedError } from '../errorDecoder/types'
import { getGenericMessageFromType } from './helpers'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.'
export const MESSAGE_PREFIX = 'The transaction cannot be estimated because'

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

      return getGenericMessageFromType(errorType, reason, MESSAGE_PREFIX, LAST_RESORT_ERROR_MESSAGE)
  }
}

export function getHumanReadableEstimationError(e: Error) {
  const decodedError = decodeError(e)
  const errorMessage = getHumanReadableErrorMessage(decodedError.reason, decodedError.type)

  return new Error(errorMessage)
}
