"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aaveHumanizer = void 0;
const aaveLendingPoolV2_1 = require("./aaveLendingPoolV2");
const aaveV3_1 = require("./aaveV3");
const aaveWethGatewayV2_1 = require("./aaveWethGatewayV2");
const aaveHumanizer = (accountOp, irCalls) => {
    const matcher = {
        ...(0, aaveLendingPoolV2_1.aaveLendingPoolV2)(),
        ...(0, aaveWethGatewayV2_1.aaveWethGatewayV2)(),
        ...(0, aaveV3_1.aaveV3Pool)()
    };
    const newCalls = irCalls.map((call) => {
        const sigHash = call.data.slice(0, 10);
        return matcher[sigHash]
            ? { ...call, fullVisualization: matcher[sigHash](accountOp, call) }
            : call;
    });
    return newCalls;
};
exports.aaveHumanizer = aaveHumanizer;
//# sourceMappingURL=index.js.map