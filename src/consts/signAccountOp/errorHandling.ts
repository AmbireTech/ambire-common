import { Warning } from '../../interfaces/signAccountOp'

const ERRORS = {
  eoaInsufficientFunds: 'Insufficient funds to cover the fee.'
}

const WARNINGS: Record<
  | 'significantBalanceDecrease'
  | 'unknownToken'
  | 'feeTokenPriceUnavailable'
  | 'v1Acc'
  | 'safeDelegateCall'
  | 'safeTxNotShownAsCalls'
  | 'incomingTokenCannotBeSold'
  | 'incomingTokenHighSellFee',
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
    title: 'Another contract gets full control of your Safe',
    text: "This transaction lets a contract that isn't part of Safe act with full control of your Safe. Only continue if you trust it."
  },
  safeTxNotShownAsCalls: {
    id: 'safeTxNotShownAsCalls',
    title: "We can't show what this transaction does",
    text: "It can give another contract full control of your Safe, and we can't check what that contract will do. Some apps do this on purpose, but scammers do it too. Only sign it if you started it yourself in an app you trust.",
    promptBefore: ['sign']
  },
  // Shown on the simulation's "Assets in" card. See `IncomingTokenSaleRisk`
  incomingTokenCannotBeSold: {
    id: 'incomingTokenCannotBeSold',
    title: "You may not be able to sell a token you're getting",
    text: 'We tried selling it in a test run after this transaction, and the sale failed. Scam tokens often let anyone buy them, then block selling.'
  },
  incomingTokenHighSellFee: {
    id: 'incomingTokenHighSellFee',
    title: "A token you're getting takes a large fee when sold",
    text: 'In a test sale after this transaction, the token kept a large part of the value. You would get much less back when you sell it.'
  }
}

/** The code of the error that blocks sending while an earlier transaction is still pending. */
const EARLIER_PENDING_TRANSACTION_ERROR_CODE = 'EARLIER_PENDING_TRANSACTION'

const RETRY_TO_INIT_ACCOUNT_OP_MSG =
  'Please attempt to initiate the transaction again or contact Ambire support.'

export { EARLIER_PENDING_TRANSACTION_ERROR_CODE, ERRORS, RETRY_TO_INIT_ACCOUNT_OP_MSG, WARNINGS }
