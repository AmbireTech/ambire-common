"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deploymentModule = void 0;
const utils_1 = require("../../utils");
const deploymentModule = (_, irCalls
// humanizerMeta: HumanizerMeta
) => {
    const newCalls = irCalls.map((irCall) => irCall.to === undefined
        ? {
            ...irCall,
            fullVisualization: [(0, utils_1.getAction)('Deploy a smart contract')]
        }
        : irCall);
    return newCalls;
};
exports.deploymentModule = deploymentModule;
//# sourceMappingURL=index.js.map