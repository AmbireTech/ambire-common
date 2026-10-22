"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
// @TODO limit order manager
// @TODO those use AVAX in the function method
// https://snowtrace.io/address/0x60aE616a2155Ee3d9A68541Ba4544862310933d4
// https://arbiscan.io/address/0xbeE5c10Cf6E4F68f831E11C1D9E59B43560B3642
// https://arbiscan.io/address/0x7BFd7192E76D950832c77BB412aaE841049D8D9B
const swapExactNATIVEForTokensAbi = (0, viem_1.parseAbi)([
    'function swapExactNATIVEForTokens(uint256 amountOutMin,(uint256[],uint8[],address[]) path,address to,uint256 deadline) payable returns (uint256)'
]);
const swapNATIVEForExactTokensAbi = (0, viem_1.parseAbi)([
    'function swapNATIVEForExactTokens(uint256 amountOut,(uint256[],uint8[],address[]) path,address to,uint256 deadline) payable returns (uint256[])'
]);
const swapExactTokensForNATIVEAbi = (0, viem_1.parseAbi)([
    'function swapExactTokensForNATIVE(uint256 amountIn,uint256 amountOutMinNATIVE,(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256)'
]);
const swapTokensForExactNATIVEAbi = (0, viem_1.parseAbi)([
    'function swapTokensForExactNATIVE(uint256 amountNATIVEOut,uint256 amountInMax,(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256[])'
]);
const swapExactTokensForTokensAbi = (0, viem_1.parseAbi)([
    'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256)'
]);
const swapTokensForExactTokensAbi = (0, viem_1.parseAbi)([
    'function swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256[])'
]);
const swapExactNATIVEForTokensSelector = (0, viem_1.toFunctionSelector)(swapExactNATIVEForTokensAbi[0]);
const swapNATIVEForExactTokensSelector = (0, viem_1.toFunctionSelector)(swapNATIVEForExactTokensAbi[0]);
const swapExactTokensForNATIVESelector = (0, viem_1.toFunctionSelector)(swapExactTokensForNATIVEAbi[0]);
const swapTokensForExactNATIVESelector = (0, viem_1.toFunctionSelector)(swapTokensForExactNATIVEAbi[0]);
const swapExactTokensForTokensSelector = (0, viem_1.toFunctionSelector)(swapExactTokensForTokensAbi[0]);
const swapTokensForExactTokensSelector = (0, viem_1.toFunctionSelector)(swapTokensForExactTokensAbi[0]);
const traderJoeModule = (accOp, call) => {
    const matcher = {
        [swapExactNATIVEForTokensSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: swapExactNATIVEForTokensAbi,
                data: call.data
            });
            const [amountOutMin, path, to, deadline] = args;
            if (!path[2])
                throw new Error('Traderjoe module: Missing path[2]');
            const tokenOut = path[2].at(-1);
            if (!tokenOut)
                throw new Error('Traderjoe module: missing tokenOut');
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(viem_1.zeroAddress, call.value),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(tokenOut, amountOutMin),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [swapNATIVEForExactTokensSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: swapNATIVEForExactTokensAbi,
                data: call.data
            });
            const [amountOut, path, to, deadline] = args;
            if (!path[2])
                throw new Error('Traderjoe module: Missing path[2]');
            const tokenOut = path[2].at(-1);
            if (!tokenOut)
                throw new Error('Traderjoe module: missing tokenOut');
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(viem_1.zeroAddress, call.value),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(tokenOut, amountOut),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [swapExactTokensForNATIVESelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: swapExactTokensForNATIVEAbi,
                data: call.data
            });
            const [amountIn, amountOutMinNATIVE, path, to, deadline] = args;
            if (!path[2])
                throw new Error('Traderjoe module: Missing path[2]');
            const tokenIn = path[2][0];
            if (!tokenIn)
                throw new Error('Traderjoe module: missing tokenOut');
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(tokenIn, amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(viem_1.zeroAddress, amountOutMinNATIVE),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [swapTokensForExactNATIVESelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: swapTokensForExactNATIVEAbi,
                data: call.data
            });
            const [amountNATIVEOut, amountInMax, path, to, deadline] = args;
            if (!path[2])
                throw new Error('Traderjoe module: Missing path[2]');
            const tokenIn = path[2][0];
            if (!tokenIn)
                throw new Error('Traderjoe module: missing tokenIn');
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(tokenIn, amountInMax),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(viem_1.zeroAddress, amountNATIVEOut),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [swapExactTokensForTokensSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: swapExactTokensForTokensAbi,
                data: call.data
            });
            const [amountIn, amountOutMin, path, to, deadline] = args;
            if (!path[2])
                throw new Error('Traderjoe module: Missing path[2]');
            const tokenOut = path[2].at(-1);
            const tokenIn = path[2][0];
            if (!tokenOut || !tokenIn)
                throw new Error('Traderjoe module: missing tokenOut or tokenIn');
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(tokenIn, amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(tokenOut, amountOutMin),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [swapTokensForExactTokensSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: swapTokensForExactTokensAbi,
                data: call.data
            });
            const [amountOut, amountInMax, path, to, deadline] = args;
            if (!path[2])
                throw new Error('Traderjoe module: Missing path[2]');
            const tokenOut = path[2].at(-1);
            const tokenIn = path[2][0];
            if (!tokenOut || !tokenIn)
                throw new Error('Traderjoe module: missing tokenOut or tokenIn');
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(tokenIn, amountInMax),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(tokenOut, amountOut),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        }
    };
    if (!(0, utils_1.isHexCall)(call))
        return call;
    const selector = call.data.slice(0, 10);
    if (call.fullVisualization || !matcher[selector])
        return call;
    return { ...call, fullVisualization: matcher[selector](call) };
};
exports.default = traderJoeModule;
//# sourceMappingURL=index.js.map