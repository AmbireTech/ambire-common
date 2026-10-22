"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShouldSimulateInTheBackground = exports.ACCOUNT_SWITCH_USER_REQUEST = void 0;
exports.ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST';
/**
 * Whether to simulate account ops if the request window is closed or the current
 * request is different.
 */
const getShouldSimulateInTheBackground = (currentReq) => {
    // simulations should get persisted for all non-Safe accounts
    if (!currentReq.signAccountOp.account.safeCreation)
        return true;
    // A Safe request that is being broadcast is no longer waiting in the queue, so its
    // simulation should stay on the dashboard until the transaction is confirmed
    if (currentReq.signAccountOp.broadcastStatus === 'LOADING')
        return true;
    // we are simulating on the dashboard only pending Safe requests
    return (currentReq.signAccountOp.accountOp.signed || []).length === 0;
};
exports.getShouldSimulateInTheBackground = getShouldSimulateInTheBackground;
//# sourceMappingURL=main.js.map