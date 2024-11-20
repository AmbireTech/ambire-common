import { EXPIRED_PREFIX } from '../errorDecoder/constants'
import { getErrorCodeStringFromReason } from '../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../errorDecoder/types'
import { RELAYER_DOWN_MESSAGE } from '../relayerCall/relayerCall'

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

const humanizeEstimationOrBroadcastError = (
  reason: string | null,
  prefix: string
): string | null => {
  switch (reason) {
    // case '0xf4059071': SafeTransferFromFailed. How should we handle this?
    case '80':
      return `${prefix} the smart contract you're interacting with doesn't support this operation. This could be due to contract restrictions, insufficient permissions, or specific conditions that haven't been met. Please review the requirements of this operation or consult the contract documentation.`
    case 'STF':
      return `${prefix} of one of the following reasons: missing approval, insufficient approved amount, the amount exceeds the account balance.`
    case 'Router: EXPIRED':
    case 'Transaction too old':
    case EXPIRED_PREFIX:
      return `${prefix} the swap has expired. Return to the dApp and reinitiate the swap if you wish to proceed.`
    case 'Router: INSUFFICIENT_OUTPUT_AMOUNT':
      return `${prefix} the slippage tolerance exceeded the allowed limit. Please go back to the dApp, adjust the slippage tolerance to a lower value, and try again.`
    case 'IMPOSSIBLE_GAS_CONSUMPTION':
    case 'INSUFFICIENT_FUNDS':
    case 'insufficient funds':
      return `${prefix} to insufficient funds for the transaction fee. Please add more fee tokens to your account and try again.`
    case 'paymaster deposit too low':
      return `${prefix} the Paymaster has insufficient funds. Please select an alternative fee payment option or contact support for assistance.`
    case 'rpc-timeout':
      return `${prefix} of a problem with the RPC on this network. Please try again later, change the RPC or contact support for assistance.`
    case 'transfer amount exceeds balance':
      return `${prefix} the transfer amount exceeds your account balance. Please reduce the transfer amount and try again.`
    case RELAYER_DOWN_MESSAGE:
      return `${prefix} the Ambire relayer is down.\nPlease try again or contact Ambire support for assistance.`
    default:
      return null
  }
}

export { humanizeEstimationOrBroadcastError, getGenericMessageFromType }
