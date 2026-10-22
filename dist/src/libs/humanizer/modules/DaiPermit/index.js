"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const utils_1 = require("../../utils");
// DAI predates EIP-2612, so its permit has no `value` param - only a boolean
// `allowed` that grants an unlimited allowance when true and revokes it when false
const daiPermitAbi = (0, viem_1.parseAbi)([
    'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)'
]);
const daiPermitSelector = (0, viem_1.toFunctionSelector)(daiPermitAbi[0]);
const daiPermitModule = (accOp, call) => {
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call) || !call.to)
        return call;
    if (call.data.slice(0, 10) !== daiPermitSelector)
        return call;
    const { args } = (0, viem_1.decodeFunctionData)({ abi: daiPermitAbi, data: (0, utils_1.padCallData)(call.data, 8) });
    const [holder, spender, , expiry, allowed] = args;
    if (!allowed)
        return {
            ...call,
            fullVisualization: [
                (0, utils_1.getAction)('Revoke approval'),
                (0, utils_1.getToken)(call.to, 0n),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getAddressVisualization)(spender),
                ...(0, utils_1.getOnBehalfOf)(holder, accOp.accountAddr)
            ]
        };
    // This permit has no amount field at all - `allowed` is the whole decision, and granting it
    // always means an unlimited allowance. There is nothing to compare against a maximum.
    return {
        ...call,
        warnings: (0, utils_1.mergeWarnings)(call.warnings, [(0, utils_1.getUnlimitedApprovalWarning)(spender)]),
        fullVisualization: [
            (0, utils_1.getAction)('Grant approval'),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(call.to, ethers_1.MaxUint256),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getAddressVisualization)(spender),
            // an expiry of 0 means the permit never expires
            ...(expiry ? [(0, utils_1.getDeadline)(expiry)] : []),
            ...(0, utils_1.getOnBehalfOf)(holder, accOp.accountAddr)
        ]
    };
};
exports.default = daiPermitModule;
//# sourceMappingURL=index.js.map