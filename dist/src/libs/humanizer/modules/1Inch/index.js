"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const cancelOrderAbi = (0, viem_1.parseAbi)(['function cancelOrder(uint256 makerTraits, bytes32 orderHash)']);
const unoswap2Abi = (0, viem_1.parseAbi)([
    'function unoswap2(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2)'
]);
const swapAbi = (0, viem_1.parseAbi)([
    'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256, uint256)'
]);
const ethUnoswapAbi = (0, viem_1.parseAbi)(['function ethUnoswap(uint256, uint256) payable returns (uint256)']);
const unoswapAbi = (0, viem_1.parseAbi)([
    'function unoswap(uint256 token,uint256 amount,uint256 minReturn,uint256 dex) returns (uint256)'
]);
const unoswapToAbi = (0, viem_1.parseAbi)([
    'function unoswapTo(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex) returns (uint256)'
]);
const unoswap3Abi = (0, viem_1.parseAbi)([
    'function unoswap3(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3) returns (uint256)'
]);
const swapWithPermitAbi = (0, viem_1.parseAbi)([
    'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)'
]);
const cancelOrderSelector = (0, viem_1.toFunctionSelector)(cancelOrderAbi[0]);
const unoswap2Selector = (0, viem_1.toFunctionSelector)(unoswap2Abi[0]);
const swapSelector = (0, viem_1.toFunctionSelector)(swapAbi[0]);
const ethUnoswapSelector = (0, viem_1.toFunctionSelector)(ethUnoswapAbi[0]);
const unoswapSelector = (0, viem_1.toFunctionSelector)(unoswapAbi[0]);
const unoswapToSelector = (0, viem_1.toFunctionSelector)(unoswapToAbi[0]);
const unoswap3Selector = (0, viem_1.toFunctionSelector)(unoswap3Abi[0]);
const swapWithPermitSelector = (0, viem_1.toFunctionSelector)(swapWithPermitAbi[0]);
const OneInchModule = (accOp, call) => {
    const matcher = {
        [cancelOrderSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: cancelOrderAbi, data: call.data });
            const [, orderHash] = args;
            return [
                (0, utils_1.getAction)('Cancel order'),
                (0, utils_1.getLabel)(`with order hash ${orderHash.slice(0, 5)}...${orderHash.slice(63, 66)}`)
            ];
        },
        [unoswap2Selector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: unoswap2Abi, data: call.data });
            const [tokenArg, amount] = args;
            const token = (0, utils_1.uintToAddress)(tokenArg);
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount)];
        },
        [swapSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: swapAbi, data: call.data });
            const [, desc] = args;
            const { srcToken, dstToken, dstReceiver, amount, minReturnAmount } = desc;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(srcToken), amount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(dstToken), minReturnAmount),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, dstReceiver)
            ];
        },
        [ethUnoswapSelector]: (call) => {
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)(viem_1.zeroAddress, call.value)];
        },
        [unoswapSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: unoswapAbi, data: call.data });
            const [tokenArg, amount] = args;
            const token = (0, utils_1.uintToAddress)(tokenArg);
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount)];
        },
        [unoswapToSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: unoswapToAbi, data: call.data });
            const [, tokenArg, amount] = args;
            const token = (0, utils_1.uintToAddress)(tokenArg);
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount)];
        },
        [unoswap3Selector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: unoswap3Abi, data: call.data });
            const [tokenArg, amount] = args;
            const token = (0, utils_1.uintToAddress)(tokenArg);
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount)];
        },
        [swapWithPermitSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: swapWithPermitAbi, data: call.data });
            const [, desc] = args;
            const { srcToken, dstToken, dstReceiver, amount, minReturnAmount } = desc;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(srcToken, amount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(dstToken, minReturnAmount),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, dstReceiver)
            ];
        }
    };
    const match = matcher[call.data.slice(0, 10)];
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call) || !match)
        return call;
    return { ...call, fullVisualization: match(call) };
};
exports.default = OneInchModule;
//# sourceMappingURL=index.js.map