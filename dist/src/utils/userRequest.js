"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCallsCount = void 0;
const getCallsCount = (userRequests) => {
    return userRequests.reduce((acc, req) => {
        if (req.kind !== 'calls' || !('calls' in req.signAccountOp.accountOp))
            return acc;
        return acc + req.signAccountOp.accountOp.calls.length;
    }, 0);
};
exports.getCallsCount = getCallsCount;
//# sourceMappingURL=userRequest.js.map