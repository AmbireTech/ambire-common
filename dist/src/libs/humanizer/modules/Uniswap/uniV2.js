"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uniV2Mapping = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const utils_2 = require("./utils");
const uniV2Mapping = () => {
    const iface = new ethers_1.Interface(abis_1.UniV2Router);
    return {
        // ordered in the same order as the router
        [iface.getFunction('swapExactTokensForTokens')?.selector]: (accountOp, call) => {
            const [amountIn, amountOutMin, path, to, deadline] = iface.parseTransaction(call)?.args || [];
            const outputAsset = path[path.length - 1];
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(path[0], amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(outputAsset, amountOutMin),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapTokensForExactTokens')?.selector]: (accountOp, call) => {
            const [amountOut, amountInMax, path, to, deadline] = iface.parseTransaction(call)?.args || [];
            const outputAsset = path[path.length - 1];
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(path[0], amountInMax),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(outputAsset, amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapExactETHForTokens')?.selector]: (accountOp, call) => {
            const { args, value } = iface.parseTransaction(call) || { value: BigInt(0) };
            const [amountOutMin, path, to, deadline] = args || [];
            const outputAsset = path[path.length - 1];
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, value),
                (0, utils_1.getLabel)('for for at least'),
                (0, utils_1.getToken)(outputAsset, amountOutMin),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapTokensForExactETH')?.selector]: (accountOp, call) => {
            const [amountOut, amountInMax, path, to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(path[0], amountInMax),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapExactTokensForETH')?.selector]: (accountOp, call) => {
            const [amountIn, amountOutMin, path, to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(path[0], amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountOutMin),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapETHForExactTokens')?.selector]: (accountOp, call) => {
            const { args, value } = iface.parseTransaction(call) || { value: BigInt(0) };
            const [amountOut, path, to, deadline] = args || [];
            const outputAsset = path[path.length - 1];
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, value),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(outputAsset, amountOut),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        // Liquidity
        [iface.getFunction('addLiquidity')?.selector]: (accountOp, call) => {
            const [tokenA, tokenB, amountADesired, amountBDesired /* amountAMin */ /* amountBMin */, , , to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Add liquidity'),
                (0, utils_1.getToken)(tokenA, amountADesired),
                (0, utils_1.getLabel)('and'),
                (0, utils_1.getToken)(tokenB, amountBDesired),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('addLiquidityETH')?.selector]: (accountOp, call) => {
            const { args, value } = iface.parseTransaction(call) || { args: [], value: BigInt(0) };
            const [token, amountTokenDesired /* amountTokenMin */ /* amountETHMin */, , , to, deadline] = args;
            return [
                (0, utils_1.getAction)('Add liquidity'),
                (0, utils_1.getToken)(token, amountTokenDesired),
                (0, utils_1.getLabel)('and'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, value),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('removeLiquidity')?.selector]: (accountOp, call) => {
            const [tokenA, tokenB /* liquidity */, , amountAMin, amountBMin, to, deadline] = iface.parseTransaction(call)?.args || [];
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
        [iface.getFunction('removeLiquidityETH')?.selector]: (accountOp, call) => {
            const [token /* liquidity */, , amountTokenMin, amountETHMin, to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Remove liquidity'),
                (0, utils_1.getLabel)('at least'),
                (0, utils_1.getToken)(token, amountTokenMin),
                (0, utils_1.getLabel)('and'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountETHMin),
                ...(0, utils_2.getUniRecipientText)(accountOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        }
        // NOTE: We currently do not support *WithPermit functions cause they require an ecrecover signature
        // Uniswap will detect we don't support it cause it will fail on requesting eth_signTypedData_v4
    };
};
exports.uniV2Mapping = uniV2Mapping;
//# sourceMappingURL=uniV2.js.map