"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShouldSimulateInTheBackground = exports.ACCOUNT_SWITCH_USER_REQUEST = void 0;
exports.ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST';
/**
 * Whether to simulate account ops if the request window is closed or the current
 * request is different.
 */
const getShouldSimulateInTheBackground = (currentReq, callUserRequests) => {
    // simulations should get persisted for all non-Safe accounts
    if (!currentReq.signAccountOp.account.safeCreation)
        return true;
    // check if there are other requests with a conflicting nonce to this one.
    // If there are, do not simulate this in the background
    const currentReqNonce = currentReq.signAccountOp.accountOp.safeTx
        ? currentReq.signAccountOp.accountOp.safeTx.nonce
        : currentReq.signAccountOp.accountOp.nonce;
    const conflictingNonceUserRequests = callUserRequests.filter((r) => {
        r.id !== currentReq.id &&
            r.signAccountOp.accountOp.chainId === currentReq.signAccountOp.accountOp.chainId &&
            r.signAccountOp.accountOp.safeTx?.nonce === currentReqNonce;
    });
    return !conflictingNonceUserRequests.length;
};
exports.getShouldSimulateInTheBackground = getShouldSimulateInTheBackground;
//# sourceMappingURL=main.js.map