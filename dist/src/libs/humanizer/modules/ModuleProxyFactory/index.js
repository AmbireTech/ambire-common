"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const deployModuleAbi = (0, viem_1.parseAbi)([
    'function deployModule(address masterCopy, bytes memory initializer, uint256 saltNonce)'
]);
const deployModuleSelector = (0, viem_1.toFunctionSelector)(deployModuleAbi[0]);
const ModuleProxyFactoryModule = (accOp, call) => {
    const matcher = {
        [deployModuleSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: deployModuleAbi, data: call.data });
            const [masterCopy] = args;
            const fullVisualization = [(0, utils_1.getAction)('Deploy module'), (0, utils_1.getAddressVisualization)(masterCopy)];
            return { ...call, fullVisualization };
        }
    };
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call))
        return call;
    const match = matcher[call.data.slice(0, 10)];
    if (!match)
        return call;
    const newCall = match(call);
    if (!newCall)
        return call;
    return newCall;
};
exports.default = ModuleProxyFactoryModule;
//# sourceMappingURL=index.js.map