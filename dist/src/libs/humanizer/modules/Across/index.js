"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const depositV3Abi = (0, viem_1.parseAbi)([
    'function depositV3(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes calldata message) payable'
]);
const depositAbi = (0, viem_1.parseAbi)([
    'function deposit(address recipient,address originToken,uint256 amount,uint256 destinationChainId,int64 relayerFeePct,uint32 quoteTimestamp,bytes memory message,uint256 maxCount) payable'
]);
const depositWithSpokePoolAbi = (0, viem_1.parseAbi)([
    'function deposit(address spokePool,address recipient,address originToken,uint256 amount,uint256 destinationChainId,int64 relayerFeePct,uint32 quoteTimestamp,bytes message,uint256 maxCount) payable'
]);
const depositV3Selector = (0, viem_1.toFunctionSelector)(depositV3Abi[0]);
const depositSelector = (0, viem_1.toFunctionSelector)(depositAbi[0]);
const depositWithSpokePoolSelector = (0, viem_1.toFunctionSelector)(depositWithSpokePoolAbi[0]);
const AcrossModule = (accOp, call) => {
    const matcher = {
        [depositV3Selector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: depositV3Abi, data: call.data });
            const [, recipient, inputToken, outputToken, inputAmount, outputAmount, destinationChainId, , , fillDeadline] = args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(inputToken, inputAmount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getTokenWithChain)(outputToken, outputAmount, destinationChainId),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(destinationChainId),
                (0, utils_1.getDeadline)(fillDeadline),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, recipient)
            ];
        },
        [depositSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: depositAbi, data: call.data });
            const [recipient, originToken, amount, destinationChainId] = args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(originToken, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(destinationChainId),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, recipient)
            ];
        },
        [depositWithSpokePoolSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: depositWithSpokePoolAbi, data: call.data });
            const [, recipient, originToken, amount, destinationChainId] = args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(originToken, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(destinationChainId),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, recipient)
            ];
        }
    };
    const selector = call.data.slice(0, 10);
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call) || !matcher[selector])
        return call;
    return { ...call, fullVisualization: matcher[selector](call) };
};
exports.default = AcrossModule;
//# sourceMappingURL=index.js.map