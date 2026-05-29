"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const ModuleProxyFactory_1 = require("../../const/abis/ModuleProxyFactory");
const utils_1 = require("../../utils");
const iface = new ethers_1.Interface(ModuleProxyFactory_1.ModuleProxyFactory);
const ModuleProxyFactoryModule = (accOp, calls) => {
    const matcher = {
        [iface.getFunction('deployModule')?.selector]: (call) => {
            const { masterCopy } = iface.parseTransaction(call).args;
            const fullVisualization = [(0, utils_1.getAction)('Deploy module'), (0, utils_1.getAddressVisualization)(masterCopy)];
            return { ...call, fullVisualization };
        }
    };
    const newCalls = calls.map((call) => {
        const match = matcher[call.data.slice(0, 10)];
        if (call.fullVisualization || !match)
            return call;
        const newCall = match(call);
        if (!newCall)
            return call;
        return newCall;
    });
    return newCalls;
};
exports.default = ModuleProxyFactoryModule;
//# sourceMappingURL=index.js.map