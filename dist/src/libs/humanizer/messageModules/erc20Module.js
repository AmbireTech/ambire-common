"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.erc20Module = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../utils");
const erc20Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (tm.primaryType !== 'Permit' ||
        !tm.types.Permit ||
        !tm.message ||
        !tm.domain.verifyingContract)
        return { fullVisualization: [] };
    // EIP-2612 permit
    if (['owner', 'spender', 'value', 'nonce', 'deadline'].every((i) => i in tm.message)) {
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Grant approval'),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(tm.domain.verifyingContract, tm.message.value),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(tm.message.spender),
                ...(tm.message.deadline ? [(0, utils_1.getDeadline)(tm.message.deadline)] : [])
            ]
        };
    }
    // DAI-style permit (pre EIP-2612): no `value`, only a boolean `allowed` that
    // grants an unlimited allowance when true and revokes it when false.
    // `expiry` of 0 means the permit never expires
    if (['holder', 'spender', 'nonce', 'expiry', 'allowed'].every((i) => i in tm.message)) {
        const isGranting = Boolean(tm.message.allowed);
        if (!isGranting)
            return {
                fullVisualization: [
                    (0, utils_1.getAction)('Revoke approval'),
                    (0, utils_1.getToken)(tm.domain.verifyingContract, 0n),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getAddressVisualization)(tm.message.spender)
                ]
            };
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Grant approval'),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(tm.domain.verifyingContract, ethers_1.MaxUint256),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(tm.message.spender),
                ...(tm.message.expiry ? [(0, utils_1.getDeadline)(tm.message.expiry)] : [])
            ]
        };
    }
    return { fullVisualization: [] };
};
exports.erc20Module = erc20Module;
//# sourceMappingURL=erc20Module.js.map