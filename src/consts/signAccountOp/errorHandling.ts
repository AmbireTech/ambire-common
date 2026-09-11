import { Warning } from '../../interfaces/signAccountOp'

const ERRORS = {
  eoaInsufficientFunds: 'Insufficient funds to cover the fee.'
}

const WARNINGS: Record<
  | 'significantBalanceDecrease'
  | 'unknownToken'
  | 'feeTokenPriceUnavailable'
  | 'v1Acc'
  | 'safeDelegateCall',
  Warning
> = {
  significantBalanceDecrease: {
    id: 'significantBalanceDecrease',
    title: 'Significant balance decrease detected',
    text: 'Our checks indicate this transaction may significantly reduce your account balance.',
    secondaryText: 'May be inaccurate when moving funds to another network or providing liquidity.'
  },
  unknownToken: {
    id: 'unknownToken',
    title: 'Unknown token detected',
    text: 'The transaction you are about to sign contains an unknown token. Please review carefully, as this token may be misleading.',
    promptBefore: ['sign']
  },
  feeTokenPriceUnavailable: {
    id: 'feeTokenPriceUnavailable',
    title: 'Unable to estimate the transaction fee in USD.'
  },
  v1Acc: {
    id: 'v1Acc',
    title: 'You can only broadcast transactions for Ambire v1 accounts from an EOA'
  },
  safeDelegateCall: {
    id: 'safeDelegateCall',
    title: 'Delegate call to an unverified contract',
    text: 'This Safe transaction delegates permissions to a contract not whitelisted by Safe. Proceed with caution.'
  }
}

const RETRY_TO_INIT_ACCOUNT_OP_MSG =
  'Please attempt to initiate the transaction again or contact Ambire support.'

export { ERRORS, RETRY_TO_INIT_ACCOUNT_OP_MSG, WARNINGS }
