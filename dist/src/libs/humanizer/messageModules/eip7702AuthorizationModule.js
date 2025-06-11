"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eip7702AuthorizationModule = void 0;
const utils_1 = require("../utils");
const eip7702AuthorizationModule = (message) => {
    if (message.content.kind !== 'authorization-7702')
        return { fullVisualization: [] };
    return {
        fullVisualization: [
            (0, utils_1.getAction)('EIP-7702 Authorization'),
            (0, utils_1.getChain)(message.content.chainId),
            (0, utils_1.getText)('Nonce'),
            (0, utils_1.getLabel)(message.content.nonce.toString()),
            (0, utils_1.getText)('Implementation'),
            (0, utils_1.getAddressVisualization)(message.content.contractAddr)
        ]
    };
};
exports.eip7702AuthorizationModule = eip7702AuthorizationModule;
//# sourceMappingURL=eip7702AuthorizationModule.js.map