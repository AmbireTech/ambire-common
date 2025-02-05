"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postProcessing = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../../utils");
const postProcessing = (_, currentIrCalls) => {
    const newCalls = currentIrCalls.map((_call) => {
        const fullVisualization = (_call?.fullVisualization || []).map((i) => {
            if (i.type === 'token' && i.address.toLowerCase() === '0x'.padEnd(42, 'e'))
                return { ...i, address: ethers_1.ZeroAddress };
            return i;
        });
        return {
            ..._call,
            fullVisualization: [...fullVisualization, (0, utils_1.getToken)(_call.to, 0n, true)]
        };
    });
    return newCalls;
};
exports.postProcessing = postProcessing;
//# sourceMappingURL=postProcessModule.js.map