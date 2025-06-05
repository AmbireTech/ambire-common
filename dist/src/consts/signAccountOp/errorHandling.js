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
        text: "The transaction you are about to sign will override the existing EIP-7702 delegation on your account with Ambire's one. Are you sure you want to proceed?",
        promptBefore: ['one-click-sign', 'sign']
    }
};
exports.WARNINGS = WARNINGS;
const RETRY_TO_INIT_ACCOUNT_OP_MSG = 'Please attempt to initiate the transaction again or contact Ambire support.';
exports.RETRY_TO_INIT_ACCOUNT_OP_MSG = RETRY_TO_INIT_ACCOUNT_OP_MSG;
//# sourceMappingURL=errorHandling.js.map