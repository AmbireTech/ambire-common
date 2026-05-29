"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WARNINGS = exports.RETRY_TO_INIT_ACCOUNT_OP_MSG = exports.ERRORS = void 0;
const ERRORS = {
    eoaInsufficientFunds: 'Insufficient funds to cover the fee.'
};
exports.ERRORS = ERRORS;
const WARNINGS = {
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
    v1Acc: {
        id: 'v1Acc',
        title: 'You can only broadcast transactions for Ambire v1 accounts from an EOA'
    }
};
exports.WARNINGS = WARNINGS;
const RETRY_TO_INIT_ACCOUNT_OP_MSG = 'Please attempt to initiate the transaction again or contact Ambire support.';
exports.RETRY_TO_INIT_ACCOUNT_OP_MSG = RETRY_TO_INIT_ACCOUNT_OP_MSG;
//# sourceMappingURL=errorHandling.js.map