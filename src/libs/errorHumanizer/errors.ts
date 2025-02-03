import { EXPIRED_PREFIX } from '../errorDecoder/constants'
import { RPC_HARDCODED_ERRORS } from '../errorDecoder/handlers/rpc'
import { RELAYER_DOWN_MESSAGE } from '../relayerCall/relayerCall'
import { ErrorHumanizerError } from './types'

const insufficientPaymasterFunds =
  "the Paymaster has insufficient funds. Please report this to the team. We've disabled it, so please try again with the updated fee payment options."

const BROADCAST_OR_ESTIMATION_ERRORS: ErrorHumanizerError[] = [
  // Rpc
  {
    reasons: ['Method not found'],
    message:
      'the RPC provider does not support the requested operation. Please check your RPC settings or contact the app team.'
  },
  {
    reasons: [RPC_HARDCODED_ERRORS.rpcTimeout, 'Unable to connect to provider'],
    message:
      'of a problem with the RPC on this network. Please try again later, change the RPC or contact support for assistance.'
  },
  {
    reasons: ['Invalid JSON RPC parameters'],
    message:
      'of a RPC request that contains invalid or missing parameters. Please try again later or contact support.'
  },
  {
    reasons: ['Too Many Requests'],
    message:
      'your wallet has sent too many requests in a short time. Please wait a moment and try again.'
  },
  // Contract / Transaction
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
    reasons: ['transfer amount exceeds balance'],
    message:
      'the transfer amount exceeds your account balance. Please check your balance or adjust the transfer amount.'
  },
  {
    reasons: ['ERC721: insufficient balance for transfer'],
    message:
      'you do not have enough of the specified NFT in your account. Please check your balance or adjust the transfer amount.'
  },
  {
    reasons: ['Low gas limit'],
    message: 'of a low gas limit. Please try again or contact support for assistance.'
  },
  {
    reasons: ['Transaction underpriced'],
    message: 'it is underpriced. Please select a higher transaction speed and try again.'
  },
  // Smart Accounts
  {
    reasons: ['Sponsorship failed.'],
    message:
      'the gas sponsorship was refused by the app. Please try again by paying for the gas instead'
  },
  {
    reasons: ['paymaster deposit too low'],
    message: insufficientPaymasterFunds
  },
  // Relayer
  {
    reasons: [RELAYER_DOWN_MESSAGE],
    message:
      'the Ambire relayer is temporarily down.\nPlease try again or contact Ambire support for assistance.'
  },
  {
    reasons: ['user nonce too low'],
    message:
      'the user nonce is too low. Is there a pending transaction? Please try broadcasting again.'
  },
  // dApp interactions
  {
    reasons: ['INSUFFICIENT_INPUT_AMOUNT'],
    message: 'the input token amount is too low. Please increase the token amount and try again.'
  },
  {
    reasons: ['INSUFFICIENT_OUTPUT_AMOUNT'],
    message:
      'the slippage tolerance was exceeded. Please reduce the slippage tolerance in the app and try again.'
  },
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
    reasons: [EXPIRED_PREFIX, 'Router: EXPIRED', 'Transaction too old'],
    message:
      'the swap has expired. Return to the app and reinitiate the swap if you wish to proceed.'
  },
  // bundler
  {
    reasons: ['biconomy: 400'],
    message: 'it will revert onchain with reason unknown.'
  },
  {
    reasons: ['pimlico: 500'],
    message: 'The bundler seems to be down at the moment. Please try again later'
  }
]

const BROADCAST_ERRORS: ErrorHumanizerError[] = [
  {
    reasons: ['pimlico_getUserOperationGasPrice'],
    message: 'the selected fee is too low. Please select a higher transaction speed and try again.'
  },
  {
    reasons: ['Replacement transaction underpriced'],
    message: 'the gas fee for replacing a pending transaction is too low. Please try again.'
  },
  {
    reasons: ['Max fee per gas less than block base fee'],
    message:
      'the fee set for the transaction is lower than the network’s current base fee. Please try again with a higher fee.'
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
    message: 'this app does not support Smart Account wallets. Use a Basic Account (EOA) instead.'
  },
  // Contract errors
  {
    reasons: ['0x7b36c479', '0x81ceff30'],
    message: 'of a Swap failure. Please try performing the same swap again.'
  },
  {
    reasons: ['ERC721: token already minted'],
    message:
      'the NFT you are trying to mint is already minted. This can also happen if you have batched multiple mint transactions for the same NFT.'
  },
  {
    reasons: ['ERC721: token does not exist'],
    message:
      'the NFT you are trying to interact with does not exist. Ensure you are using the correct token ID.'
  },
  {
    reasons: ['Inner call: 0x'],
    message: 'it reverted onchain with reason unknown.'
  },
  // Rare contract errors
  {
    reasons: ['AccessControl: account is missing role'],
    message:
      'your account lacks the necessary permissions to perform this action. Please contact the contract owner or ensure you have the required role.'
  },
  {
    reasons: ['Pausable: paused'],
    message:
      'the contract is currently paused. Please wait until it is active or contact the contract owner for more information.'
  },
  {
    reasons: ['Contract code size exceeds'],
    message:
      'the contract’s size exceeds the EVM limit for deployment. Please ensure the contract is optimized before redeploying.'
  },
  {
    reasons: ['Constructor reverted'],
    message:
      'the smart contract’s initialization failed. This is likely a deployment issue; please check the constructor parameters.'
  }
]

export {
  BROADCAST_OR_ESTIMATION_ERRORS,
  BROADCAST_ERRORS,
  ESTIMATION_ERRORS,
  insufficientPaymasterFunds
}
