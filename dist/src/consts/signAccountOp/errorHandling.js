const ERRORS = {
    eoaInsufficientFunds: 'Insufficient funds to cover the fee.'
};
const WARNINGS = {
    significantBalanceDecrease: {
        id: 'significantBalanceDecrease',
        title: 'Significant Account Balance Decrease',
        text: 'The transaction you are about to sign will significantly decrease your account balance. Please review the transaction details carefully.',
        promptBeforeSign: true,
        displayBeforeSign: true
    },
    feeTokenPriceUnavailable: {
        id: 'feeTokenPriceUnavailable',
        title: 'Unable to estimate the transaction fee in USD.',
        promptBeforeSign: false,
        displayBeforeSign: true
    }
};
const RETRY_TO_INIT_ACCOUNT_OP_MSG = 'Please attempt to initiate the transaction again or contact Ambire support.';
export { ERRORS, WARNINGS, RETRY_TO_INIT_ACCOUNT_OP_MSG };
//# sourceMappingURL=errorHandling.js.map