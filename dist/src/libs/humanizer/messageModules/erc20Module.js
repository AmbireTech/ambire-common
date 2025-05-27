"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.erc20Module = void 0;
const utils_1 = require("../utils");
const erc20Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (tm.types.Permit &&
        tm.primaryType === 'Permit' &&
        tm.message &&
        ['owner', 'spender', 'value', 'nonce', 'deadline'].every((i) => i in tm.message) &&
        tm.domain.verifyingContract) {
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Grant approval'),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(tm.domain.verifyingContract, tm.message.value),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(tm.message.spender),
                tm.message.deadline ? (0, utils_1.getDeadline)(tm.message.deadline) : null
            ].filter((x) => x)
        };
    }
    return { fullVisualization: [] };
};
exports.erc20Module = erc20Module;
//# sourceMappingURL=erc20Module.js.map