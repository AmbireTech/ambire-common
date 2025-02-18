"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const KyberModule = (accOp, calls) => {
    const iface = new ethers_1.Interface(abis_1.KyberSwap);
    const matcher = {
        [iface.getFunction('swap(tuple(address callTarget,address approveTarget,bytes targetData,tuple(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution)')?.selector]: (call) => {
            const { execution: { desc: { srcToken, dstToken, amount, minReturnAmount } } } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(srcToken), amount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(dstToken), minReturnAmount)
            ];
        },
        [iface.getFunction('swapSimpleMode(address caller, tuple(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes executorData,bytes clientData)')?.selector]: (call) => {
            const { desc: { srcToken, dstToken, amount, minReturnAmount } } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(srcToken), amount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(dstToken), minReturnAmount)
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
exports.default = KyberModule;
//# sourceMappingURL=index.js.map