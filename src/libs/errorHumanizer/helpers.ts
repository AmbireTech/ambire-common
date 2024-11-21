import { getErrorCodeStringFromReason } from '../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../errorDecoder/types'

const REASON_HIDDEN_FOR = [ErrorType.RelayerError, ErrorType.PaymasterError]

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
    case ErrorType.PaymasterError:
      return `${messagePrefix} of a Paymaster error.${messageSuffix}`
    case ErrorType.RpcError:
      return `${messagePrefix} of an RPC error.${messageSuffix}`
    case ErrorType.BundlerError:
      return `${messagePrefix} of a Bundler error.${messageSuffix}`
    case ErrorType.UnknownError:
      return `${messagePrefix} of an unknown error.${messageSuffix}`
    case ErrorType.InnerCallFailureError:
      return `${messagePrefix} of a failure while validating the transaction.${messageSuffix}`
    // Panic error may scare the user so let's call it a contract error
    case ErrorType.PanicError:
    case ErrorType.RevertError:
      return `${messagePrefix} of a contract error.${messageSuffix}`
    default:
      return lastResortMessage
  }
}

export { getGenericMessageFromType }
