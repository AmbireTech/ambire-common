"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aaveHumanizer = void 0;
const utils_1 = require("../../utils");
const aaveLendingPoolV2_1 = require("./aaveLendingPoolV2");
const aaveV3_1 = require("./aaveV3");
const aaveWethGatewayV2_1 = require("./aaveWethGatewayV2");
const matcher = {
    ...(0, aaveLendingPoolV2_1.aaveLendingPoolV2)(),
    ...(0, aaveWethGatewayV2_1.aaveWethGatewayV2)(),
    ...(0, aaveV3_1.aaveV3Pool)()
};
const aaveHumanizer = (accountOp, call) => {
    if (!call.to || !(0, utils_1.isHexCall)(call))
        return call;
    const sigHash = call.data.slice(0, 10);
    return matcher[sigHash] ? { ...call, fullVisualization: matcher[sigHash](accountOp, call) } : call;
};
exports.aaveHumanizer = aaveHumanizer;
//# sourceMappingURL=index.js.map