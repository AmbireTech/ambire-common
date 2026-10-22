"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const swapAbi = (0, viem_1.parseAbi)([
    'function swap((address callTarget,address approveTarget,bytes targetData,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256,uint256)'
]);
const swapSimpleModeAbi = (0, viem_1.parseAbi)([
    'function swapSimpleMode(address caller,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes executorData,bytes clientData) returns (uint256,uint256)'
]);
const swapSelector = (0, viem_1.toFunctionSelector)(swapAbi[0]);
const swapSimpleModeSelector = (0, viem_1.toFunctionSelector)(swapSimpleModeAbi[0]);
const KyberModule = (accOp, call) => {
    const matcher = {
        [swapSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: swapAbi, data: call.data });
            const [execution] = args;
            const { srcToken, dstToken, amount, minReturnAmount } = execution.desc;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(srcToken), amount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(dstToken), minReturnAmount)
            ];
        },
        [swapSimpleModeSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: swapSimpleModeAbi, data: call.data });
            const [, desc] = args;
            const { srcToken, dstToken, amount, minReturnAmount } = desc;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(srcToken), amount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(dstToken), minReturnAmount)
            ];
        }
    };
    const match = matcher[call.data.slice(0, 10)];
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call) || !match)
        return call;
    return { ...call, fullVisualization: match(call) };
};
exports.default = KyberModule;
//# sourceMappingURL=index.js.map