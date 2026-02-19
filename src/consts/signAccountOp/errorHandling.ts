import { Warning } from '../../interfaces/signAccountOp'

const ERRORS = {
  eoaInsufficientFunds: 'Insufficient funds to cover the fee.'
}

const WARNINGS: { [key: string]: Warning } = {
  significantBalanceDecrease: {
    id: 'significantBalanceDecrease',
    title: 'Significant Account Balance Decrease',
    text: 'The transaction you are about to sign will significantly decrease your account balance. Please review the transaction details carefully.',
    promptBefore: ['sign']
  },
  unknownToken: {
    id: 'unknownToken',
    title: 'Unknown token detected',
    text: 'The transaction you are about to sign contains an unknown token. Please review carefully, as this token may be misleading.',
    promptBefore: ['sign']
  },
  possibleBalanceDecrease: {
    id: 'possibleBalanceDecrease',
    title: 'Significant Account Balance Decrease (Possibly Inaccurate)',
    text: 'The transaction you are about to sign may significantly decrease your account balance. However, due to temporary issues in discovering new portfolio tokens, this information might not be fully accurate. Please review the transaction details carefully.',
    promptBefore: ['sign']
  },
  feeTokenPriceUnavailable: {
    id: 'feeTokenPriceUnavailable',
    title: 'Unable to estimate the transaction fee in USD.'
  },
  delegationDetected: {
    id: 'delegationDetected',
    title: 'Delegation detected',
    text: 'The transaction you are about to sign will override the existing EIP-7702 delegation on your account. Are you sure you want to proceed?',
    promptBefore: ['one-click-sign', 'sign'],
    type: 'info3'
  },
  v1Acc: {
    id: 'v1Acc',
    title: 'Broadcasting Ambire V1 transactions is limited to external accounts.'
  }
}

const RETRY_TO_INIT_ACCOUNT_OP_MSG =
  'Please attempt to initiate the transaction again or contact Ambire support.'

export { ERRORS, RETRY_TO_INIT_ACCOUNT_OP_MSG, WARNINGS }
