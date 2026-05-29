"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const utils_1 = require("../../utils");
const iface = new ethers_1.Interface(['function pledge()']);
const TrustlessManifestoModule = (accOp, calls) => {
    const newCalls = calls.map((call) => {
        if (call.data &&
            call.data.startsWith(iface.getFunction('pledge')?.selector) &&
            (0, ethers_1.isAddress)(call.to) &&
            (0, ethers_1.getAddress)(call.to) === '0x32AA964746ba2be65C71fe4A5cB3c4a023cA3e20')
            return {
                ...call,
                fullVisualization: [
                    (0, utils_1.getAction)('Sign'),
                    (0, utils_1.getLabel)('the'),
                    (0, utils_1.getLabel)('Trustless Manifesto Pledge', true)
                ]
            };
        return call;
    });
    return newCalls;
};
exports.default = TrustlessManifestoModule;
//# sourceMappingURL=index.js.map