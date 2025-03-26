import { isReasonValid } from '../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../errorDecoder/types'
import { ErrorHumanizerError } from './types'

function getGenericMessageFromType(
  errorType: ErrorType,
  reason: DecodedError['reason'],
  messagePrefix: string,
  lastResortMessage: string
): string {
  const supportSuffix = ' Please try again or contact Ambire support for assistance.'
  const origin = errorType?.split('Error')?.[0] || ''

  switch (errorType) {
    case ErrorType.RelayerError:
    case ErrorType.RpcError:
      return `${messagePrefix} of an unknown error (Origin: ${origin} call).${supportSuffix}`
    case ErrorType.PaymasterError:
      return `${messagePrefix} of a Paymaster Error.${supportSuffix}`
    case ErrorType.BundlerError:
      return `${messagePrefix} it's invalid.`
    case ErrorType.CodeError:
    case ErrorType.UnknownError:
      return `${messagePrefix} of an unknown error.${supportSuffix}`
    case ErrorType.InnerCallFailureError:
      return isReasonValid(reason)
        ? `${messagePrefix} it will revert onchain.`
        : `${messagePrefix} it will revert onchain with reason unknown.${supportSuffix}`
    // I don't think we should say anything else for this case
    case ErrorType.UserRejectionError:
      return 'Transaction rejected.'
    // Panic error may scare the user so let's call it a contract error
    case ErrorType.CustomError:
    case ErrorType.PanicError:
    case ErrorType.RevertError:
      return `${messagePrefix} of a contract error.`
    default:
      return lastResortMessage
  }
}

const getHumanReadableErrorMessage = (
  commonError: string | null,
  errors: ErrorHumanizerError[],
  messagePrefix: string,
  reason: DecodedError['reason'],
  e: any
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

  return message
}

export { getGenericMessageFromType, getHumanReadableErrorMessage }
