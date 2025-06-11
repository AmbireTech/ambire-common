"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const AcrossModule = (accOp, calls) => {
    const iface = new ethers_1.Interface(abis_1.Across);
    const matcher = {
        [iface.getFunction('depositV3(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes calldata message)')?.selector]: (call) => {
            const { recipient, inputToken, outputToken, inputAmount, outputAmount, destinationChainId, fillDeadline } = iface.parseTransaction(call).args;
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
        [iface.getFunction('deposit(address recipient,address originToken,uint256 amount,uint256 destinationChainId,int64 relayerFeePct,uint32 quoteTimestamp,bytes memory message,uint256 maxCount)')?.selector]: (call) => {
            const { recipient, originToken, amount, destinationChainId } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(originToken, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(destinationChainId),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, recipient)
            ];
        },
        [iface.getFunction('function deposit(address spokePool,address recipient, address originToken, uint256 amount, uint256 destinationChainId, int64 relayerFeePct, uint32 quoteTimestamp,bytes message, uint256 maxCount) payable')?.selector]: (call) => {
            const { recipient, originToken, amount, destinationChainId } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(originToken, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(destinationChainId),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, recipient)
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
exports.default = AcrossModule;
//# sourceMappingURL=index.js.map