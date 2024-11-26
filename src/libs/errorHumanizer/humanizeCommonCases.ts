import { EXPIRED_PREFIX } from '../errorDecoder/constants'
import { RPC_HARDCODED_ERRORS } from '../errorDecoder/handlers/rpc'
import { RELAYER_DOWN_MESSAGE } from '../relayerCall/relayerCall'

const ERRORS = {
  '80': "the smart contract you're interacting with doesn't support this operation. This could be due to contract restrictions, insufficient permissions, or specific conditions that haven't been met. Please review the requirements of this operation or consult the contract documentation.",
  STF: 'of one of the following reasons: missing approval, insufficient approved amount, the amount exceeds the account balance.',
  [EXPIRED_PREFIX]:
    'the swap has expired. Return to the dApp and reinitiate the swap if you wish to proceed.',
  'Router: EXPIRED':
    'the swap has expired. Return to the dApp and reinitiate the swap if you wish to proceed.',
  'Transaction too old':
    'the swap has expired. Return to the dApp and reinitiate the swap if you wish to proceed.',
  'Router: INSUFFICIENT_OUTPUT_AMOUNT':
    'the slippage tolerance exceeded the allowed limit. Please go back to the dApp, adjust the slippage tolerance to a lower value, and try again.',
  IMPOSSIBLE_GAS_CONSUMPTION:
    'of a low gas limit. Please try again or contact support for assistance.',
  INSUFFICIENT_FUNDS:
    'of insufficient funds for the transaction fee. Please add more fee tokens to your account and try again.',
  'insufficient funds':
    'of insufficient funds for the transaction fee. Please add more fee tokens to your account and try again.',
  'paymaster deposit too low':
    'the Paymaster has insufficient funds. Please select an alternative fee payment option or contact support for assistance.',
  [RPC_HARDCODED_ERRORS.rpcTimeout]:
    'of a problem with the RPC on this network. Please try again later, change the RPC or contact support for assistance.',
  'transfer amount exceeds balance':
    'the transfer amount exceeds your account balance. Please reduce the transfer amount and try again.',
  'Low gas limit': 'of a low gas limit. Please try again or contact support for assistance.',
  'Transaction underpriced':
    'it is underpriced. Please select a higher transaction speed and try again.',
  [RELAYER_DOWN_MESSAGE]:
    'the Ambire relayer is down.\nPlease try again or contact Ambire support for assistance.'
}

const humanizeEstimationOrBroadcastError = (
  reason: string | null,
  prefix: string
): string | null => {
  let message = null

  if (!reason) return message

  Object.keys(ERRORS).forEach((key) => {
    if (!reason.toLowerCase().includes(key.toLowerCase())) return

    message = `${prefix} ${ERRORS[key]}`
  })

  return message
}

export { humanizeEstimationOrBroadcastError }
