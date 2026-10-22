"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uniV2Mapping = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const utils_2 = require("./utils");
const swapExactTokensForTokensAbi = (0, viem_1.parseAbi)([
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
]);
const swapTokensForExactTokensAbi = (0, viem_1.parseAbi)([
    'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
]);
const swapExactETHForTokensAbi = (0, viem_1.parseAbi)([
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)'
]);
const swapTokensForExactETHAbi = (0, viem_1.parseAbi)([
    'function swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
]);
const swapExactTokensForETHAbi = (0, viem_1.parseAbi)([
    'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
]);
const swapETHForExactTokensAbi = (0, viem_1.parseAbi)([
    'function swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)'
]);
const addLiquidityAbi = (0, viem_1.parseAbi)([
    'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)'
]);
const addLiquidityETHAbi = (0, viem_1.parseAbi)([
    'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)'
]);
const removeLiquidityAbi = (0, viem_1.parseAbi)([
    'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)'
]);
const removeLiquidityETHAbi = (0, viem_1.parseAbi)([
    'function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)'
]);
exports.uniV2Mapping = {
    // ordered in the same order as the router
    [(0, viem_1.toFunctionSelector)(swapExactTokensForTokensAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapExactTokensForTokensAbi,
            data: call.data
        });
        const [, , path, to, deadline] = args;
        const outputAsset = path[path.length - 1];
        if (!path[0] || !outputAsset)
            throw new Error('UniV2: missing assets in path');
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(path[0], 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(outputAsset, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [(0, viem_1.toFunctionSelector)(swapTokensForExactTokensAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapTokensForExactTokensAbi,
            data: call.data
        });
        const [, , path, to, deadline] = args;
        const outputAsset = path[path.length - 1];
        if (!path[0] || !outputAsset)
            throw new Error('UniV2: missing assets in path');
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(path[0], 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(outputAsset, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [(0, viem_1.toFunctionSelector)(swapExactETHForTokensAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: swapExactETHForTokensAbi, data: call.data });
        const [, path, to, deadline] = args;
        const outputAsset = path[path.length - 1];
        if (!outputAsset)
            throw new Error('UniV2: missing assets in path');
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(viem_1.zeroAddress, 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(outputAsset, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [(0, viem_1.toFunctionSelector)(swapTokensForExactETHAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: swapTokensForExactETHAbi, data: call.data });
        const [, , path, to, deadline] = args;
        if (!path[0])
            throw new Error('UniV2: missing assets in path');
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(path[0], 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(viem_1.zeroAddress, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [(0, viem_1.toFunctionSelector)(swapExactTokensForETHAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: swapExactTokensForETHAbi, data: call.data });
        const [, , path, to, deadline] = args;
        if (!path[0])
            throw new Error('UniV2: missing assets in path');
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(path[0], 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(viem_1.zeroAddress, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [(0, viem_1.toFunctionSelector)(swapETHForExactTokensAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: swapETHForExactTokensAbi, data: call.data });
        const [, path, to, deadline] = args;
        const outputAsset = path[path.length - 1];
        if (!outputAsset)
            throw new Error('UniV2: missing assets in path');
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(viem_1.zeroAddress, 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(outputAsset, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    // Liquidity
    [(0, viem_1.toFunctionSelector)(addLiquidityAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: addLiquidityAbi, data: call.data });
        const [tokenA, tokenB, amountADesired, amountBDesired /* amountAMin */ /* amountBMin */, , , to, deadline] = args;
        return [
            (0, utils_1.getAction)('Add liquidity'),
            (0, utils_1.getToken)(tokenA, amountADesired),
            (0, utils_1.getLabel)('and'),
            (0, utils_1.getToken)(tokenB, amountBDesired),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [(0, viem_1.toFunctionSelector)(addLiquidityETHAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: addLiquidityETHAbi, data: call.data });
        const [token, amountTokenDesired /* amountTokenMin */ /* amountETHMin */, , , to, deadline] = args;
        return [
            (0, utils_1.getAction)('Add liquidity'),
            (0, utils_1.getToken)(token, amountTokenDesired),
            (0, utils_1.getLabel)('and'),
            (0, utils_1.getToken)(viem_1.zeroAddress, call.value),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [(0, viem_1.toFunctionSelector)(removeLiquidityAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: removeLiquidityAbi, data: call.data });
        const [tokenA, tokenB /* liquidity */, , amountAMin, amountBMin, to, deadline] = args;
        return [
            (0, utils_1.getAction)('Remove liquidity'),
            (0, utils_1.getLabel)('at least'),
            (0, utils_1.getToken)(tokenA, amountAMin),
            (0, utils_1.getLabel)('and'),
            (0, utils_1.getToken)(tokenB, amountBMin),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [(0, viem_1.toFunctionSelector)(removeLiquidityETHAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: removeLiquidityETHAbi, data: call.data });
        const [token /* liquidity */, , amountTokenMin, amountETHMin, to, deadline] = args;
        return [
            (0, utils_1.getAction)('Remove liquidity'),
            (0, utils_1.getLabel)('at least'),
            (0, utils_1.getToken)(token, amountTokenMin),
            (0, utils_1.getLabel)('and'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amountETHMin),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
            (0, utils_1.getDeadline)(deadline)
        ];
    }
    // NOTE: We currently do not support *WithPermit functions cause they require an ecrecover signature
    // Uniswap will detect we don't support it cause it will fail on requesting eth_signTypedData_v4
};
//# sourceMappingURL=uniV2.js.map