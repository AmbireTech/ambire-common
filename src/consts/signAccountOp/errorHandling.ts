import { Warning } from '../../interfaces/signAccountOp'

/** Errors that don't prevent signing */
const NON_CRITICAL_ERRORS = {
  feeUsdEstimation: 'Unable to estimate the transaction fee in USD.'
}
const ERRORS = {
  eoaInsufficientFunds: 'Insufficient funds to cover the fee.'
}

const WARNINGS: { [key: string]: Warning } = {
  significantBalanceDecrease: {
    id: 'significantBalanceDecrease',
    title: 'Significant Account Balance Decrease',
    text: 'The transaction you are about to sign will significantly decrease your account balance. Please review the transaction details carefully.',
    promptBeforeSign: true,
    displayBeforeSign: true
  }
}

const RETRY_TO_INIT_ACCOUNT_OP_MSG =
  'Please attempt to initiate the transaction again or contact Ambire support.'

export { NON_CRITICAL_ERRORS, ERRORS, WARNINGS, RETRY_TO_INIT_ACCOUNT_OP_MSG }
