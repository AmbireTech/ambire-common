import { EXPIRED_PREFIX } from '../errorDecoder/constants'
import { RPC_HARDCODED_ERRORS } from '../errorDecoder/handlers/rpc'
import { RELAYER_DOWN_MESSAGE } from '../relayerCall/relayerCall'
import { ErrorHumanizerError } from './types'

const insufficientPaymasterFunds =
  "the Paymaster has insufficient funds. Please report this to the team. We've disabled it, so please try again with the updated fee payment options."

const BROADCAST_OR_ESTIMATION_ERRORS: ErrorHumanizerError[] = [
  {
    reasons: ['80'],
    message:
      "the smart contract you're interacting with doesn't support this operation. This could be due to contract restrictions, insufficient permissions, or specific conditions that haven't been met. Please review the requirements of this operation or consult the contract documentation."
  },
  {
    reasons: ['STF'],
    message:
      'of one of the following reasons: missing approval, insufficient approved amount, the amount exceeds the account balance.'
  },
  {
    reasons: ['Sponsorship failed.'],
    message:
      'the gas sponsorship was refused by the dapp. Please try again by paying for the gas instead'
  },
  {
    reasons: [EXPIRED_PREFIX, 'Router: EXPIRED', 'Transaction too old'],
    message:
      'the swap has expired. Return to the dApp and reinitiate the swap if you wish to proceed.'
  },
  {
    reasons: ['Router: INSUFFICIENT_OUTPUT_AMOUNT'],
    message:
      'the slippage tolerance exceeded the allowed limit. Please go back to the dApp, adjust the slippage tolerance to a lower value, and try again.'
  },
  {
    reasons: ['IMPOSSIBLE_GAS_CONSUMPTION'],
    message: 'of a low gas limit. Please try again or contact support for assistance.'
  },
  {
    reasons: ['INSUFFICIENT_FUNDS', 'insufficient funds'],
    message:
      'of insufficient funds for the transaction fee. Please add more fee tokens to your account and try again.'
  },
  {
    reasons: ['paymaster deposit too low'],
    message: insufficientPaymasterFunds
  },
  {
    reasons: [RPC_HARDCODED_ERRORS.rpcTimeout],
    message:
      'of a problem with the RPC on this network. Please try again later, change the RPC or contact support for assistance.'
  },
  {
    reasons: ['transfer amount exceeds balance'],
    message:
      'the transfer amount exceeds your account balance. Please reduce the transfer amount and try again.'
  },
  {
    reasons: ['Low gas limit'],
    message: 'of a low gas limit. Please try again or contact support for assistance.'
  },
  {
    reasons: ['Transaction underpriced'],
    message: 'it is underpriced. Please select a higher transaction speed and try again.'
  },
  {
    reasons: [RELAYER_DOWN_MESSAGE],
    message:
      'the Ambire relayer is down.\nPlease try again or contact Ambire support for assistance.'
  }
]

const BROADCAST_ERRORS: ErrorHumanizerError[] = [
  {
    reasons: ['pimlico_getUserOperationGasPrice'],
    message: 'the selected fee is too low. Please select a higher transaction speed and try again.'
  }
]

const ESTIMATION_ERRORS: ErrorHumanizerError[] = [
  {
    reasons: ['SPOOF_ERROR', 'INSUFFICIENT_PRIVILEGE'],
    message:
      'your account key lacks the necessary permissions. Ensure that you have authorization to sign or use an account with sufficient privileges.'
  },
  {
    reasons: [
      'caller is a contract',
      'contract not allowed',
      'contract not supported',
      'No contractz allowed',
      'contracts allowed',
      'ontract is not allowed'
    ],
    message:
      'because this dApp does not support Smart Account wallets. Please use a Basic Account (EOA) to interact with this dApp.'
  }
]

export {
  BROADCAST_OR_ESTIMATION_ERRORS,
  BROADCAST_ERRORS,
  ESTIMATION_ERRORS,
  insufficientPaymasterFunds
}
