"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deploymentModule = void 0;
const utils_1 = require("../../utils");
const deploymentModule = (_, call
// humanizerMeta: HumanizerMeta
) => call.to === undefined
    ? {
        ...call,
        fullVisualization: [(0, utils_1.getAction)('Deploy a smart contract')]
    }
    : call;
exports.deploymentModule = deploymentModule;
//# sourceMappingURL=index.js.map