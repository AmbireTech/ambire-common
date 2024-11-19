import { EXPIRED_PREFIX } from '../errorDecoder/constants'
import { getErrorCodeStringFromReason } from '../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../errorDecoder/types'

function getGenericMessageFromType(
  errorType: ErrorType,
  reason: DecodedError['reason'],
  messagePrefix: string,
  lastResortMessage: string
): string {
  const reasonString = getErrorCodeStringFromReason(reason ?? '')

  switch (errorType) {
    case ErrorType.RelayerError:
      return `${messagePrefix} the Ambire relayer is down. Please try again later, broadcast with a Basic Account or contact Ambire support for assistance.`
    case ErrorType.PaymasterError:
      return `${messagePrefix} of a Paymaster error. Please try again, broadcast with a Basic Account or contact Ambire support for assistance.`
    case ErrorType.RpcError:
      return `${messagePrefix} of an RPC error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.PanicError:
      return `${messagePrefix} of a panic error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.BundlerError:
      return `${messagePrefix} of a Bundler error. ${reasonString}\nPlease try again or contact Ambire support for assistance.`
    case ErrorType.UnknownError:
      return `${messagePrefix} of an unknown error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.InnerCallFailureError:
      return `${messagePrefix} of a failure while validating the transaction. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.RevertError:
      return `${messagePrefix} of a revert error. Please try again or contact Ambire support for assistance.${reasonString}`
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
    default:
      return null
  }
}

export { humanizeEstimationOrBroadcastError, getGenericMessageFromType }
