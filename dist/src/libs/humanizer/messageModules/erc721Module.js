"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.erc721Module = void 0;
const utils_1 = require("../utils");
const visualizePermit = (spender, tokenId, deadline, contract) => {
    const res = [
        (0, utils_1.getAction)('Permit use of'),
        (0, utils_1.getToken)(contract, tokenId),
        (0, utils_1.getLabel)('to'),
        (0, utils_1.getAddressVisualization)(spender)
    ];
    if ((0, utils_1.getDeadline)(deadline))
        res.push((0, utils_1.getDeadline)(deadline));
    return res;
};
const erc721Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (tm.types.Permit &&
        tm.primaryType === 'Permit' &&
        tm.message.spender &&
        tm.message.tokenId &&
        tm.message.nonce &&
        tm.message.deadline) {
        return {
            fullVisualization: visualizePermit(tm.message.spender, tm.message.tokenId, tm.message.deadline, tm.domain.verifyingContract)
        };
    }
    return { fullVisualization: [] };
};
exports.erc721Module = erc721Module;
//# sourceMappingURL=erc721Module.js.map