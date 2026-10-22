"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const pledgeAbi = (0, viem_1.parseAbi)(['function pledge()']);
const pledgeSelector = (0, viem_1.toFunctionSelector)(pledgeAbi[0]);
const TrustlessManifestoModule = (accOp, call) => {
    if (call.data &&
        call.data.startsWith(pledgeSelector) &&
        call.to &&
        (0, viem_1.isAddress)(call.to) &&
        (0, viem_1.getAddress)(call.to) === '0x32AA964746ba2be65C71fe4A5cB3c4a023cA3e20')
        return {
            ...call,
            fullVisualization: [
                (0, utils_1.getAction)('Sign'),
                (0, utils_1.getLabel)('the'),
                (0, utils_1.getLabel)('Trustless Manifesto Pledge', true)
            ]
        };
    return call;
};
exports.default = TrustlessManifestoModule;
//# sourceMappingURL=index.js.map