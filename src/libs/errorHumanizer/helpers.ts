import { getErrorCodeStringFromReason, isReasonValid } from '../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../errorDecoder/types'
import { ErrorHumanizerError } from './types'

function getGenericMessageFromType(
  errorType: ErrorType,
  reason: DecodedError['reason'],
  messagePrefix: string,
  lastResortMessage: string,
  withReason = true
): string {
  const messageSuffixNoSupport = withReason ? getErrorCodeStringFromReason(reason ?? '') : ''
  const messageSuffix = `${messageSuffixNoSupport}\nPlease try again or contact Ambire support for assistance.`
  const origin = errorType?.split('Error')?.[0] || ''

  switch (errorType) {
    case ErrorType.RelayerError:
    case ErrorType.RpcError:
      return `${messagePrefix} of an unknown error (Origin: ${origin} call).${messageSuffix}`
    case ErrorType.PaymasterError:
      return `${messagePrefix} of a Paymaster Error.${messageSuffix}`
    case ErrorType.BundlerError:
      return `${messagePrefix} it's invalid.${messageSuffixNoSupport}`
    case ErrorType.CodeError:
    case ErrorType.UnknownError:
      return `${messagePrefix} of an unknown error.${messageSuffix}`
    case ErrorType.InnerCallFailureError:
      return isReasonValid(reason)
        ? `${messagePrefix} it will revert onchain.${messageSuffixNoSupport}`
        : `${messagePrefix} it will revert onchain with reason unknown.${messageSuffix}`
    // I don't think we should say anything else for this case
    case ErrorType.UserRejectionError:
      return 'Transaction rejected.'
    // Panic error may scare the user so let's call it a contract error
    case ErrorType.CustomError:
    case ErrorType.PanicError:
    case ErrorType.RevertError:
      return `${messagePrefix} of a contract error.${messageSuffixNoSupport}`
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

  if (checkAgainst && typeof checkAgainst === 'string') {
    errors.forEach((error) => {
      const { isExactMatch } = error

      const isMatching = error.reasons.some((errorReason) => {
        const lowerCaseReason = errorReason.toLowerCase()

        if (isExactMatch) {
          // Try a simple equality check first
          if (errorReason === checkAgainst) return true

          // Split checkAgainst by spaces and check if any of the parts
          // match the lowerCaseReason
          const splitCheckAgainst = checkAgainst.split(' ')

          return splitCheckAgainst.some((part) => part.toLowerCase() === lowerCaseReason)
        }

        return checkAgainst.toLowerCase().includes(lowerCaseReason)
      })
      if (!isMatching) return

      message = `${messagePrefix ? `${messagePrefix} ` : ''}${error.message}`
    })
  }

  return message
}

export { getGenericMessageFromType, getHumanReadableErrorMessage }
