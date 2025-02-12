"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uniV3Mapping = exports.uniV32Mapping = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const utils_2 = require("./utils");
const uniV32Mapping = () => {
    const ifaceV32 = new ethers_1.Interface(abis_1.UniV3Router2);
    return {
        // 0x5ae401dc
        [ifaceV32.getFunction('multicall(uint256 deadline,bytes[])')?.selector]: (accountOp, call) => {
            const [deadline, calls] = ifaceV32.parseTransaction(call)?.args || [];
            const mappingResult = uniV32Mapping();
            const parsed = calls.map((data) => {
                const sigHash = data.slice(0, 10);
                const humanizer = mappingResult[sigHash];
                return humanizer ? humanizer(accountOp, { ...call, data }) : [(0, utils_1.getAction)('Unknown action')];
            });
            const res = (0, utils_2.uniReduce)(parsed);
            return res.length ? [...res, (0, utils_1.getDeadline)(deadline)] : (0, utils_1.getUnknownVisualization)('Uni V3', call);
        },
        // 0xac9650d8
        [ifaceV32.getFunction('multicall(bytes[])')?.selector]: (accountOp, call) => {
            const [calls] = ifaceV32.parseTransaction(call)?.args || [];
            const mappingResult = uniV32Mapping();
            const parsed = calls.map((data) => {
                const sigHash = data.slice(0, 10);
                const humanizer = mappingResult[sigHash];
                return humanizer ? humanizer(accountOp, { ...call, data }) : [(0, utils_1.getAction)('Unknown action')];
            });
            return (0, utils_2.uniReduce)(parsed);
        },
        // 0x1f0464d1
        [ifaceV32.getFunction('multicall(bytes32 prevBlockHash, bytes[])')?.selector]: (accountOp, call) => {
            const [prevBlockHash, calls] = ifaceV32.parseTransaction(call)?.args || [];
            const mappingResult = uniV32Mapping();
            const parsed = calls.map((data) => {
                const sigHash = data.slice(0, 10);
                const humanizer = mappingResult[sigHash];
                return humanizer ? humanizer(accountOp, { ...call, data }) : [(0, utils_1.getAction)('Unknown action')];
            });
            return parsed.length
                ? (0, utils_2.uniReduce)(parsed)
                : [...(0, utils_1.getUnknownVisualization)('Uni V3', call), (0, utils_1.getLabel)(`after block ${prevBlockHash}`)];
        },
        // NOTE: selfPermit is not supported cause it requires an ecrecover signature
        // 0x04e45aaf
        [ifaceV32.getFunction('exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            // @TODO: consider fees
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(params.tokenIn, params.amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(params.tokenOut, params.amountOutMinimum),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
            ];
        },
        // 0x414bf389
        [ifaceV32.getFunction('exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(params.tokenIn, params.amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(params.tokenOut, params.amountOutMinimum),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
                (0, utils_1.getDeadline)(params.deadline)
            ];
        },
        // 0xb858183f
        [ifaceV32.getFunction('exactInput')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            const path = (0, utils_2.parsePath)(params.path);
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(path[0], params.amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(path[path.length - 1], params.amountOutMinimum),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
            ];
        },
        // 0x5023b4df
        [ifaceV32.getFunction('exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params)')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(params.tokenIn, params.amountInMaximum),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(params.tokenOut, params.amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
            ];
        },
        // 0xdb3e2198
        [ifaceV32.getFunction('exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params)')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(params.tokenIn, params.amountInMaximum),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(params.tokenOut, params.amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
                (0, utils_1.getDeadline)(params.deadline)
            ];
        },
        // 0x12210e8a
        [ifaceV32.getFunction('refundETH()')?.selector]: (accountOp, call) => {
            return [(0, utils_1.getAction)('Withdraw'), (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value)];
        },
        // 0x09b81346
        [ifaceV32.getFunction('exactOutput')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            const path = (0, utils_2.parsePath)(params.path);
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(path[path.length - 1], params.amountInMaximum),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(path[0], params.amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient)
            ];
        },
        // 0x42712a67
        [ifaceV32.getFunction('swapTokensForExactTokens')?.selector]: (accountOp, call) => {
            const [amountOut, amountInMax, path, to] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(path[0], amountInMax),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(path[path.length - 1], amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to)
            ];
        },
        // 0x472b43f3
        [ifaceV32.getFunction('swapExactTokensForTokens')?.selector]: (accountOp, call) => {
            const [amountIn, amountOutMin, path, to] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(path[0], amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(path[path.length - 1], amountOutMin),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to)
            ];
        },
        // 0x49616997
        [ifaceV32.getFunction('unwrapWETH9(uint256)')?.selector]: (_accountOp, call) => {
            const [amountMin] = ifaceV32.parseTransaction(call)?.args || [];
            return [(0, utils_1.getAction)('Unwrap'), (0, utils_1.getToken)(ethers_1.ZeroAddress, amountMin)];
        },
        // 0x49404b7c
        [ifaceV32.getFunction('unwrapWETH9(uint256,address recipient)')?.selector]: (accountOp, call) => {
            const [amountMin, recipient] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Unwrap'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountMin),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
            ];
        },
        // 0xe90a182f
        [ifaceV32.getFunction('sweepToken(address,uint256)')?.selector]: (_accountOp, call) => {
            const [token, amountMinimum] = ifaceV32.parseTransaction(call)?.args || [];
            return [(0, utils_1.getAction)('Sweep'), (0, utils_1.getLabel)('at least'), (0, utils_1.getToken)(token, amountMinimum)];
        },
        // 0xdf2ab5bb
        [ifaceV32.getFunction('sweepToken(address,uint256,address)')?.selector]: (accountOp, call) => {
            const [token, amountMinimum, recipient] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Sweep'),
                (0, utils_1.getLabel)('at least'),
                (0, utils_1.getToken)(token, amountMinimum),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
            ];
        },
        // 0x3068c554
        [ifaceV32.getFunction('sweepTokenWithFee(address,uint256,uint256,address)')?.selector]: (_accountOp, call) => {
            const [token, amountMinimum, feeBips, feeRecipient] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Sweep'),
                (0, utils_1.getLabel)('at least'),
                (0, utils_1.getToken)(token, amountMinimum),
                (0, utils_1.getLabel)('with fee'),
                (0, utils_1.getToken)(token, feeBips),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(feeRecipient)
            ];
        },
        // 0xe0e189a0
        [`${ifaceV32.getFunction('sweepTokenWithFee(address,uint256,address,uint256,address)')?.selector}`]: (accountOp, call) => {
            const [token, amountMinimum, recipient, feeBips, feeRecipient] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Sweep'),
                (0, utils_1.getLabel)('at least'),
                (0, utils_1.getToken)(token, amountMinimum),
                (0, utils_1.getLabel)('with fee'),
                (0, utils_1.getToken)(token, feeBips),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(feeRecipient),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
            ];
        },
        // 0x88316456
        [`${ifaceV32.getFunction('mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))')?.selector}`]: (accountOp, call) => {
            const [[token0, token1, , , , , , 
            // fee,
            // tickLower,
            // tickUpper,
            // amount0Desired,
            // amount1Desired,
            amount0Min, amount1Min, recipient, deadline]] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Add liquidity'),
                (0, utils_1.getToken)(token0, amount0Min),
                (0, utils_1.getToken)(token1, amount1Min),
                (0, utils_1.getLabel)('pair'),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, recipient),
                (0, utils_1.getDeadline)(deadline)
            ];
        }
    };
};
exports.uniV32Mapping = uniV32Mapping;
const uniV3Mapping = () => {
    const ifaceV3 = new ethers_1.Interface(abis_1.UniV3Router);
    return {
        // 0xac9650d8
        [ifaceV3.getFunction('multicall')?.selector]: (accountOp, call) => {
            const args = ifaceV3.parseTransaction(call)?.args || [];
            const calls = args[args.length - 1];
            const mappingResult = uniV3Mapping();
            const parsed = calls.map((data) => {
                const sigHash = data.slice(0, 10);
                const humanizer = mappingResult[sigHash];
                return humanizer ? humanizer(accountOp, { ...call, data }) : [(0, utils_1.getAction)('Unknown action')];
            });
            return parsed.length ? (0, utils_2.uniReduce)(parsed) : (0, utils_1.getUnknownVisualization)('Uni V3', call);
        },
        // -------------------------------------------------------------------------------------------------
        // NOTE: selfPermit is not supported cause it requires an ecrecover signature
        // 0x414bf389
        [ifaceV3.getFunction('exactInputSingle')?.selector]: (accountOp, call) => {
            const [params] = ifaceV3.parseTransaction(call)?.args || [];
            // @TODO: consider fees
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(params.tokenIn, params.amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(params.tokenOut, params.amountOutMinimum),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
                (0, utils_1.getDeadline)(params.deadline)
            ];
        },
        // 0xc04b8d59
        [ifaceV3.getFunction('exactInput')?.selector]: (accountOp, call) => {
            const [params] = ifaceV3.parseTransaction(call)?.args || [];
            const path = (0, utils_2.parsePath)(params.path);
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(path[0], params.amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(path[path.length - 1], params.amountOutMinimum),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
                (0, utils_1.getDeadline)(params.deadline)
            ];
        },
        // 0xdb3e2198
        [ifaceV3.getFunction('exactOutputSingle')?.selector]: (accountOp, call) => {
            const [params] = ifaceV3.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(params.tokenIn, params.amountInMaximum),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(params.tokenOut, params.amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
                (0, utils_1.getDeadline)(params.deadline)
            ];
        },
        // 0xf28c0498
        [ifaceV3.getFunction('exactOutput')?.selector]: (accountOp, call) => {
            const [params] = ifaceV3.parseTransaction(call)?.args || [];
            const path = (0, utils_2.parsePath)(params.path);
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(path[path.length - 1], params.amountInMaximum),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(path[0], params.amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, params.recipient),
                (0, utils_1.getDeadline)(params.deadline)
            ];
        },
        // 0x49404b7c
        [ifaceV3.getFunction('unwrapWETH9')?.selector]: (accountOp, call) => {
            const [amountMin, recipient] = ifaceV3.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Unwrap'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountMin),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
            ];
        },
        // 0x9b2c0a37
        [ifaceV3.getFunction('unwrapWETH9WithFee')?.selector]: (accountOp, call) => {
            const [amountMin, recipient, feeBips, feeRecipient] = ifaceV3.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Unwrap'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountMin),
                (0, utils_1.getLabel)('with fee'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, feeBips),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(feeRecipient),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, recipient)
            ];
        },
        // 0x12210e8a
        [ifaceV3.getFunction('refundETH()')?.selector]: () => {
            return [(0, utils_1.getAction)('Refund')];
        }
    };
};
exports.uniV3Mapping = uniV3Mapping;
//# sourceMappingURL=uniV3.js.map