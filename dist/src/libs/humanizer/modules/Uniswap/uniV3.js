"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uniV3Mapping = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const utils_2 = require("./utils");
// UniV3Router2 ABIs
const multicallDeadlineAbi = (0, viem_1.parseAbi)([
    'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])'
]);
const multicallBytesAbi = (0, viem_1.parseAbi)([
    'function multicall(bytes[] data) payable returns (bytes[] results)'
]);
const multicallPrevBlockHashAbi = (0, viem_1.parseAbi)([
    'function multicall(bytes32 previousBlockhash, bytes[] data) payable returns (bytes[])'
]);
const exactInputSingleNoDeadlineAbi = (0, viem_1.parseAbi)([
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
]);
const exactInputSingleWithDeadlineAbi = (0, viem_1.parseAbi)([
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
]);
const exactInputV32Abi = (0, viem_1.parseAbi)([
    'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)'
]);
const exactOutputSingleNoDeadlineAbi = (0, viem_1.parseAbi)([
    'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)'
]);
const exactOutputSingleWithDeadlineAbi = (0, viem_1.parseAbi)([
    'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)'
]);
const refundETHAbi = (0, viem_1.parseAbi)(['function refundETH() payable']);
const exactOutputV32Abi = (0, viem_1.parseAbi)([
    'function exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)'
]);
const swapTokensForExactTokensV32Abi = (0, viem_1.parseAbi)([
    'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to) payable returns (uint256 amountIn)'
]);
const swapExactTokensForTokensV32Abi = (0, viem_1.parseAbi)([
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to) payable returns (uint256 amountOut)'
]);
const unwrapWETH9NoRecipientAbi = (0, viem_1.parseAbi)(['function unwrapWETH9(uint256 amountMinimum) payable']);
const unwrapWETH9WithRecipientAbi = (0, viem_1.parseAbi)([
    'function unwrapWETH9(uint256 amountMinimum, address recipient) payable'
]);
const sweepTokenNoRecipientAbi = (0, viem_1.parseAbi)([
    'function sweepToken(address token, uint256 amountMinimum) payable'
]);
const sweepTokenWithRecipientAbi = (0, viem_1.parseAbi)([
    'function sweepToken(address token, uint256 amountMinimum, address recipient) payable'
]);
const sweepTokenWithFeeNoRecipientAbi = (0, viem_1.parseAbi)([
    'function sweepTokenWithFee(address token, uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable'
]);
const sweepTokenWithFeeWithRecipientAbi = (0, viem_1.parseAbi)([
    'function sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable'
]);
const mintV32Abi = (0, viem_1.parseAbi)([
    'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
]);
// UniV3Router ABIs
const exactInputV3Abi = (0, viem_1.parseAbi)([
    'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)'
]);
const exactOutputV3Abi = (0, viem_1.parseAbi)([
    'function exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)'
]);
const unwrapWETH9WithFeeAbi = (0, viem_1.parseAbi)([
    'function unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable'
]);
exports.uniV3Mapping = {
    // 0x5ae401dc
    [(0, viem_1.toFunctionSelector)(multicallDeadlineAbi[0])]: (accountOp, call) => {
        if (!call.to)
            throw Error('Humanizer: should not be in uniswap humanizer when !call.to');
        const { args } = (0, viem_1.decodeFunctionData)({ abi: multicallDeadlineAbi, data: call.data });
        const [deadline, calls] = args;
        const mappingResult = exports.uniV3Mapping;
        const parsed = calls.map((data) => {
            const sigHash = data.slice(0, 10);
            const humanizer = mappingResult[sigHash];
            return humanizer ? humanizer(accountOp, { ...call, data }) : [(0, utils_1.getAction)('Uniswap action')];
        });
        const res = (0, utils_2.uniReduce)(parsed);
        return res.length
            ? [...res, (0, utils_1.getDeadline)(deadline)]
            : [(0, utils_1.getAction)('Uniswap action'), (0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(call.to)];
    },
    // 0xac9650d8
    [(0, viem_1.toFunctionSelector)(multicallBytesAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: multicallBytesAbi, data: call.data });
        const [calls] = args;
        const mappingResult = exports.uniV3Mapping;
        const parsed = calls.map((data) => {
            const sigHash = data.slice(0, 10);
            const humanizer = mappingResult[sigHash];
            return humanizer ? humanizer(accountOp, { ...call, data }) : [(0, utils_1.getAction)('Uniswap action')];
        });
        return (0, utils_2.uniReduce)(parsed);
    },
    // 0x1f0464d1
    [(0, viem_1.toFunctionSelector)(multicallPrevBlockHashAbi[0])]: (accountOp, call) => {
        if (!call.to)
            throw Error('Humanizer: should not be in uniswap humanizer when !call.to');
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: multicallPrevBlockHashAbi,
            data: call.data
        });
        const [, calls] = args;
        const mappingResult = exports.uniV3Mapping;
        const parsed = calls.map((data) => {
            const sigHash = data.slice(0, 10);
            const humanizer = mappingResult[sigHash];
            return humanizer ? humanizer(accountOp, { ...call, data }) : [(0, utils_1.getAction)('Uniswap action')];
        });
        return parsed.length
            ? (0, utils_2.uniReduce)(parsed)
            : [(0, utils_1.getAction)('Uniswap action'), (0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(call.to)];
    },
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    // 0x04e45aaf
    [(0, viem_1.toFunctionSelector)(exactInputSingleNoDeadlineAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: exactInputSingleNoDeadlineAbi,
            data: call.data
        });
        const [params] = args;
        // @TODO: consider fees
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(params.tokenIn, 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(params.tokenOut, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
        ];
    },
    // 0x414bf389
    [(0, viem_1.toFunctionSelector)(exactInputSingleWithDeadlineAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: exactInputSingleWithDeadlineAbi,
            data: call.data
        });
        const [params] = args;
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(params.tokenIn, 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(params.tokenOut, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
            (0, utils_1.getDeadline)(params.deadline)
        ];
    },
    // 0xb858183f
    [(0, viem_1.toFunctionSelector)(exactInputV32Abi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exactInputV32Abi, data: call.data });
        const [params] = args;
        const path = (0, utils_2.parsePath)(params.path);
        if (!path.length)
            return [];
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(path[0], 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(path[path.length - 1], 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
        ];
    },
    // 0x5023b4df
    [(0, viem_1.toFunctionSelector)(exactOutputSingleNoDeadlineAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: exactOutputSingleNoDeadlineAbi,
            data: call.data
        });
        const [params] = args;
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(params.tokenIn, 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(params.tokenOut, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
        ];
    },
    // 0xdb3e2198
    [(0, viem_1.toFunctionSelector)(exactOutputSingleWithDeadlineAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: exactOutputSingleWithDeadlineAbi,
            data: call.data
        });
        const [params] = args;
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(params.tokenIn, 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(params.tokenOut, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
            (0, utils_1.getDeadline)(params.deadline)
        ];
    },
    // 0x12210e8a
    [(0, viem_1.toFunctionSelector)(refundETHAbi[0])]: (_accountOp, call) => {
        return [(0, utils_1.getAction)('Withdraw'), (0, utils_1.getToken)(viem_1.zeroAddress, call.value)];
    },
    // 0x09b81346
    [(0, viem_1.toFunctionSelector)(exactOutputV32Abi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exactOutputV32Abi, data: call.data });
        const [params] = args;
        const path = (0, utils_2.parsePath)(params.path);
        if (!path.length)
            return [];
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(path[path.length - 1], 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(path[0], 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
        ];
    },
    // 0x42712a67
    [(0, viem_1.toFunctionSelector)(swapTokensForExactTokensV32Abi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapTokensForExactTokensV32Abi,
            data: call.data
        });
        const [, , path, to] = args;
        const firstToken = path[0];
        const lastToken = path[path.length - 1];
        if (!firstToken || !lastToken)
            throw new Error('UniV3: missing tokens in path');
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(firstToken, 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(lastToken, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to)
        ];
    },
    // 0x472b43f3
    [(0, viem_1.toFunctionSelector)(swapExactTokensForTokensV32Abi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapExactTokensForTokensV32Abi,
            data: call.data
        });
        const [, , path, to] = args;
        const firstToken = path[0];
        const lastToken = path[path.length - 1];
        if (!firstToken || !lastToken)
            throw new Error('UniV3: missing tokens in path');
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(firstToken, 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(lastToken, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to)
        ];
    },
    // 0x49616997
    [(0, viem_1.toFunctionSelector)(unwrapWETH9NoRecipientAbi[0])]: () => {
        return [(0, utils_1.getAction)('Unwrap'), (0, utils_1.getToken)(viem_1.zeroAddress, 0n)];
    },
    // 0x49404b7c
    [(0, viem_1.toFunctionSelector)(unwrapWETH9WithRecipientAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: unwrapWETH9WithRecipientAbi,
            data: call.data
        });
        const [, recipient] = args;
        return [
            (0, utils_1.getAction)('Unwrap'),
            (0, utils_1.getToken)(viem_1.zeroAddress, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
        ];
    },
    // 0xe90a182f
    [(0, viem_1.toFunctionSelector)(sweepTokenNoRecipientAbi[0])]: (_accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: sweepTokenNoRecipientAbi,
            data: call.data
        });
        const [token] = args;
        return [(0, utils_1.getAction)('Sweep'), (0, utils_1.getToken)(token, 0n)];
    },
    // 0xdf2ab5bb
    [(0, viem_1.toFunctionSelector)(sweepTokenWithRecipientAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: sweepTokenWithRecipientAbi,
            data: call.data
        });
        const [token, , recipient] = args;
        return [
            (0, utils_1.getAction)('Sweep'),
            (0, utils_1.getToken)(token, 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
        ];
    },
    // 0x3068c554
    [(0, viem_1.toFunctionSelector)(sweepTokenWithFeeNoRecipientAbi[0])]: (_accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: sweepTokenWithFeeNoRecipientAbi,
            data: call.data
        });
        const [token, , feeBips, feeRecipient] = args;
        return [
            (0, utils_1.getAction)('Sweep'),
            (0, utils_1.getToken)(token, 0n),
            (0, utils_1.getLabel)('with fee'),
            (0, utils_1.getToken)(token, feeBips),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getAddressVisualization)(feeRecipient)
        ];
    },
    // 0xe0e189a0
    [(0, viem_1.toFunctionSelector)(sweepTokenWithFeeWithRecipientAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: sweepTokenWithFeeWithRecipientAbi,
            data: call.data
        });
        const [token, , recipient, feeBips, feeRecipient] = args;
        return [
            (0, utils_1.getAction)('Sweep'),
            (0, utils_1.getToken)(token, 0n),
            (0, utils_1.getLabel)('with fee'),
            (0, utils_1.getToken)(token, feeBips),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getAddressVisualization)(feeRecipient),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
        ];
    },
    // 0x88316456
    [(0, viem_1.toFunctionSelector)(mintV32Abi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: mintV32Abi, data: call.data });
        const [params] = args;
        return [
            (0, utils_1.getAction)('Add liquidity'),
            (0, utils_1.getToken)(params.token0, params.amount0Desired),
            (0, utils_1.getToken)(params.token1, params.amount1Desired),
            (0, utils_1.getLabel)('pair'),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, params.recipient),
            (0, utils_1.getDeadline)(params.deadline)
        ];
    },
    // -------------------------------------------------------------------------------------------------
    // NOTE: selfPermit is not supported cause it requires an ecrecover signature
    // 0xc04b8d59
    [(0, viem_1.toFunctionSelector)(exactInputV3Abi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exactInputV3Abi, data: call.data });
        const [params] = args;
        const path = (0, utils_2.parsePath)(params.path);
        if (!path.length)
            return [];
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(path[0], 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(path[path.length - 1], 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
            (0, utils_1.getDeadline)(params.deadline)
        ];
    },
    // 0xf28c0498
    [(0, viem_1.toFunctionSelector)(exactOutputV3Abi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exactOutputV3Abi, data: call.data });
        const [params] = args;
        const path = (0, utils_2.parsePath)(params.path);
        if (!path.length)
            return [];
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(path[path.length - 1], 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(path[0], 0n),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
            (0, utils_1.getDeadline)(params.deadline)
        ];
    },
    // 0x9b2c0a37
    [(0, viem_1.toFunctionSelector)(unwrapWETH9WithFeeAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: unwrapWETH9WithFeeAbi, data: call.data });
        const [, recipient, feeBips, feeRecipient] = args;
        return [
            (0, utils_1.getAction)('Unwrap'),
            (0, utils_1.getToken)(viem_1.zeroAddress, 0n),
            (0, utils_1.getLabel)('with fee'),
            (0, utils_1.getToken)(viem_1.zeroAddress, feeBips),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getAddressVisualization)(feeRecipient),
            ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
        ];
    }
};
//# sourceMappingURL=uniV3.js.map