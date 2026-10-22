"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embeddedAmbireOperationHumanizer = exports.EMBEDDED_OPERATION_WARNING_CODE = void 0;
const utils_1 = require("../../utils");
exports.EMBEDDED_OPERATION_WARNING_CODE = 'AMBIRE_EMBEDDED_OPERATION';
// the purpose of this module is simply to visualize attempts to hide ambire operations within the current account op
// such thing can be done if the dapp requests a tryCatch/executeBySelfSingle/executeBySelf/... function call directed to the current account
// this call will be executed without needing extra authentication. For more details check out AmbireAccount.sol
const embeddedAmbireOperationHumanizer = (accountOp, call) => {
    if (!call.to)
        return call;
    if (call.fullVisualization)
        return call;
    if (call.data === '0x')
        return call;
    if (call.to.toLowerCase() === accountOp.accountAddr.toLowerCase()) {
        return {
            ...call,
            fullVisualization: [(0, utils_1.getAction)('Allow multiple actions from this account')],
            warnings: [
                ...(call.warnings || []),
                (0, utils_1.getWarning)('This lets the app perform several actions using your account, one after another, without asking you to confirm each one separately. Only proceed if you trust it', exports.EMBEDDED_OPERATION_WARNING_CODE)
            ]
        };
    }
    return call;
};
exports.embeddedAmbireOperationHumanizer = embeddedAmbireOperationHumanizer;
//# sourceMappingURL=index.js.map