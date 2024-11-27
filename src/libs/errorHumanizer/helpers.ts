import { getErrorCodeStringFromReason } from '../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../errorDecoder/types'
import { ErrorHumanizerError } from './types'

const REASON_HIDDEN_FOR = [ErrorType.RelayerError, ErrorType.PaymasterError]
export const PAYMASTER_DOWN_ERROR =
  'Currently, the paymaster seems to be down and your transaction cannot be broadcast. Please try again in a few moments or pay the fee with a Basic Account if the error persists'

function getGenericMessageFromType(
  errorType: ErrorType,
  reason: DecodedError['reason'],
  messagePrefix: string,
  lastResortMessage: string
): string {
  const reasonString = !REASON_HIDDEN_FOR.includes(errorType)
    ? getErrorCodeStringFromReason(reason ?? '')
    : ''
  const messageSuffix = `${reasonString}\nPlease try again or contact Ambire support for assistance.`

  switch (errorType) {
    case ErrorType.RelayerError:
      return `${messagePrefix} of an Ambire Relayer error.${messageSuffix}`
    case ErrorType.HardwareWalletRejectedError:
      return reason ?? 'Rejected by your hardware wallet device'
    case ErrorType.PaymasterError:
      return reasonString === ''
        ? PAYMASTER_DOWN_ERROR
        : `${messagePrefix} of a Paymaster error.${messageSuffix}`
    case ErrorType.RpcError:
      return `${messagePrefix} of an RPC error.${messageSuffix}`
    case ErrorType.BundlerError:
      return `${messagePrefix} of a Bundler error.${messageSuffix}`
    case ErrorType.UnknownError:
      return `${messagePrefix} of an unknown error.${messageSuffix}`
    case ErrorType.InnerCallFailureError:
      return `${messagePrefix} of a failure while validating the transaction.${messageSuffix}`
    // I don't think we should say anything else for this case
    case ErrorType.UserRejectionError:
      return 'Transaction rejected.'
    // Panic error may scare the user so let's call it a contract error
    case ErrorType.PanicError:
    case ErrorType.RevertError:
      return `${messagePrefix} of a contract error.${messageSuffix}`
    default:
      return lastResortMessage
  }
}

const getHumanReadableErrorMessage = (
  commonError: any,
  errors: ErrorHumanizerError[],
  messagePrefix: string,
  lastResortMessage: string,
  reason: DecodedError['reason'],
  e: any,
  errorType: DecodedError['type']
) => {
  if (commonError) return commonError

  const checkAgainst = reason || e?.error?.message || e?.message
  let message = null

  if (checkAgainst) {
    errors.forEach((error) => {
      const isMatching = error.reasons.some((errorReason) =>
        checkAgainst.toLowerCase().includes(errorReason.toLowerCase())
      )
      if (!isMatching) return

      message = `${messagePrefix} ${error.message}`
    })
  }

  if (!message) {
    return getGenericMessageFromType(errorType, reason, messagePrefix, lastResortMessage)
  }

  return message
}

export { getGenericMessageFromType, getHumanReadableErrorMessage }
