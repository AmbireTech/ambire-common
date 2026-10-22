"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
// This is the Permit2 `approve`, which Pancake's permit contract shares. Permit2 keeps the
// allowance itself instead of the token contract, so the token is an argument rather than the
// call target, and the amount is a uint160 - its "no limit" value is smaller than the uint256
// one an ERC-20 approval uses.
const approveAbi = (0, viem_1.parseAbi)([
    'function approve(address token, address spender, uint160 amount, uint48 expiration)'
]);
const approveSelector = (0, viem_1.toFunctionSelector)(approveAbi[0]);
const PancakeModule = (accOp, call) => {
    const matcher = {
        [approveSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: approveAbi, data: (0, utils_1.padCallData)(call.data, 4) });
            const [token, spender, amount, expiration] = args;
            const expirationHumanization = expiration > 0 ? (0, utils_1.getDeadline)(expiration) : (0, utils_1.getLabel)('now');
            if (amount === 0n)
                return {
                    visualizations: [
                        (0, utils_1.getAction)('Revoke approval'),
                        (0, utils_1.getToken)(token, amount),
                        (0, utils_1.getLabel)('for'),
                        (0, utils_1.getAddressVisualization)(spender)
                    ]
                };
            return {
                visualizations: [
                    (0, utils_1.getAction)('Approve'),
                    (0, utils_1.getAddressVisualization)(spender),
                    (0, utils_1.getLabel)('to use'),
                    (0, utils_1.getToken)(token, amount),
                    expirationHumanization
                ],
                warning: (0, utils_1.isUnlimitedAmount)(amount, 160) ? (0, utils_1.getUnlimitedApprovalWarning)(spender) : undefined
            };
        }
    };
    const selector = call.data.slice(0, 10);
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call) || !matcher[selector])
        return call;
    const { visualizations, warning } = matcher[selector](call);
    return {
        ...call,
        fullVisualization: visualizations,
        warnings: (0, utils_1.mergeWarnings)(call.warnings, warning ? [warning] : [])
    };
};
exports.default = PancakeModule;
//# sourceMappingURL=index.js.map