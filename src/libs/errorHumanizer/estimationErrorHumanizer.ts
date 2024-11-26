import EmittableError from '../../classes/EmittableError'
import { decodeError } from '../errorDecoder'
import { getHumanReadableErrorMessage } from './helpers'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

export const MESSAGE_PREFIX = 'The transaction cannot be estimated because'
const LAST_RESORT_ERROR_MESSAGE =
  'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.'
const SA_UNSUPPORTED_ERROR_MESSAGE =
  'because this dApp does not support Smart Account wallets. Please use a Basic Account (EOA) to interact with this dApp.'
const ERRORS: { [key: string]: string } = {
  SPOOF_ERROR:
    'your account key lacks the necessary permissions. Ensure that you have authorization to sign or use an account with sufficient privileges.',
  INSUFFICIENT_PRIVILEGE:
    'your account key lacks the necessary permissions. Ensure that you have authorization to sign or use an account with sufficient privileges.',
  'caller is a contract': SA_UNSUPPORTED_ERROR_MESSAGE,
  'contract not allowed': SA_UNSUPPORTED_ERROR_MESSAGE,
  'contract not supported': SA_UNSUPPORTED_ERROR_MESSAGE,
  'No contractz allowed': SA_UNSUPPORTED_ERROR_MESSAGE,
  'contracts allowed': SA_UNSUPPORTED_ERROR_MESSAGE,
  'ontract is not allowed': SA_UNSUPPORTED_ERROR_MESSAGE
}

export function getHumanReadableEstimationError(e: Error) {
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
