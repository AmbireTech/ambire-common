"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const Pancake_1 = require("../../const/abis/Pancake");
const utils_1 = require("../../utils");
const PancakeModule = (accOp, calls) => {
    const iface = new ethers_1.Interface(Pancake_1.Pancake);
    const matcher = {
        [iface.getFunction('approve(address token, address spender, uint160 amount, uint48 expiration)')
            ?.selector]: (call) => {
            const { token, spender, amount, expiration } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Approve'),
                (0, utils_1.getAddressVisualization)(spender),
                (0, utils_1.getLabel)('to use'),
                (0, utils_1.getToken)(token, amount),
                (0, utils_1.getDeadline)(expiration)
            ];
        }
    };
    const newCalls = calls.map((call) => {
        if (call.fullVisualization || !matcher[call.data.slice(0, 10)])
            return call;
        return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) };
    });
    return newCalls;
};
exports.default = PancakeModule;
//# sourceMappingURL=index.js.map