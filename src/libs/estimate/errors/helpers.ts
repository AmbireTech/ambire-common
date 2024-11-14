import { CONTRACT_ERRORS, EXPIRED_PREFIX } from '../../errorDecoder/constants'
import { isReasonValid } from '../../errorDecoder/helpers'
import { DecodedError, ErrorType } from '../../errorDecoder/types'

const LAST_RESORT_ERROR_MESSAGE =
  'An error occurred during the transaction. Please try again or contact Ambire support for assistance.'

function getGenericMessageFromType(errorType: ErrorType, reason: DecodedError['reason']): string {
  let reasonString = ''

  if (reason && isReasonValid(reason)) {
    const truncatedReason = reason.length > 100 ? `${reason.slice(0, 100)}...` : reason
    reasonString = ` Error code: ${truncatedReason}`
  }

  switch (errorType) {
    case ErrorType.RpcError:
      return `Transaction cannot be sent because of an RPC error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.PanicError:
      return `Transaction cannot be sent because of a panic error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.BundlerAndPaymasterErrorHandler:
      return `Transaction cannot be sent because of a Bundler/Paymaster error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.UnknownError:
      return `Transaction cannot be sent because of an unknown error. Please try again or contact Ambire support for assistance.${reasonString}`
    case ErrorType.InnerCallFailureError:
      return `Transaction cannot be sent because of a failure while validating the transaction. Please try again or contact Ambire support for assistance.${reasonString}`
    default:
      return LAST_RESORT_ERROR_MESSAGE
  }
}

const getHumanReadableErrorMessage = (
  reason: DecodedError['reason'],
  errorType: DecodedError['type']
) => {
  switch (reason) {
    case '80':
      return "The smart contract you're interacting with doesn't support this operation. This could be due to contract restrictions, insufficient permissions, or specific conditions that haven't been met. Please review the requirements of this operation or consult the contract documentation."
    case 'STF':
      return 'The transaction cannot be sent due to one of the following reasons: missing approval, insufficient approved amount, the amount exceeds the account balance.'
    case 'Router: EXPIRED':
    case 'Transaction too old':
    case EXPIRED_PREFIX:
      return 'The transaction cannot be sent because the swap has expired. Return to the dApp and reinitiate the swap if you wish to proceed.'
    case 'Router: INSUFFICIENT_OUTPUT_AMOUNT':
      return 'The transaction cannot be sent because the slippage tolerance exceeded the allowed limit. Please go back to the dApp, adjust the slippage tolerance to a lower value, and try again.'
    case 'SPOOF_ERROR':
    case 'INSUFFICIENT_PRIVILEGE':
      return 'The transaction cannot be sent because your account key lacks the necessary permissions. Ensure that you have authorization to sign or use an account with sufficient privileges.'
    case 'IMPOSSIBLE_GAS_CONSUMPTION':
    case 'INSUFFICIENT_FUNDS':
    case 'insufficient funds':
      return 'The transaction could not be sent due to insufficient funds for the transaction fee. Please add more fee tokens to your account and try again.'
    case 'paymaster deposit too low':
      return 'The transaction cannot be sent because the Paymaster has insufficient funds. Please select an alternative fee payment option or contact support for assistance.'
    case '0xf4059071':
    case 'rpc-timeout':
      return 'There seems to be a problem with the RPC on this network. Please try again later, change the RPC or contact support for assistance.'
    case 'transfer amount exceeds balance':
      return 'The transaction failed because the transfer amount exceeds your account balance. Please reduce the transfer amount and try again.'
    default:
      if (CONTRACT_ERRORS.find((contractMsg) => reason?.includes(contractMsg)))
        return 'This dApp does not support Smart Account wallets. Please use a Basic Account (EOA) to interact with this dApp.'

      return getGenericMessageFromType(errorType, reason)
  }
}

export { getGenericMessageFromType, getHumanReadableErrorMessage }
