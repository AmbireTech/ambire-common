import { Interface, ZeroAddress } from 'ethers';
import { UniV2Router } from '../../const/abis';
import { getAction, getDeadline, getLabel, getToken } from '../../utils';
import { getUniRecipientText } from './utils';
const uniV2Mapping = () => {
    const iface = new Interface(UniV2Router);
    return {
        // ordered in the same order as the router
        [iface.getFunction('swapExactTokensForTokens')?.selector]: (accountOp, call) => {
            const [amountIn, amountOutMin, path, to, deadline] = iface.parseTransaction(call)?.args || [];
            const outputAsset = path[path.length - 1];
            return [
                getAction('Swap'),
                getToken(path[0], amountIn),
                getLabel('for at least'),
                getToken(outputAsset, amountOutMin),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        [iface.getFunction('swapTokensForExactTokens')?.selector]: (accountOp, call) => {
            const [amountOut, amountInMax, path, to, deadline] = iface.parseTransaction(call)?.args || [];
            const outputAsset = path[path.length - 1];
            return [
                getAction('Swap up to'),
                getToken(path[0], amountInMax),
                getLabel('for'),
                getToken(outputAsset, amountOut),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        [iface.getFunction('swapExactETHForTokens')?.selector]: (accountOp, call) => {
            const { args, value } = iface.parseTransaction(call) || { value: BigInt(0) };
            const [amountOutMin, path, to, deadline] = args || [];
            const outputAsset = path[path.length - 1];
            return [
                getAction('Swap'),
                getToken(ZeroAddress, value),
                getLabel('for for at least'),
                getToken(outputAsset, amountOutMin),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        [iface.getFunction('swapTokensForExactETH')?.selector]: (accountOp, call) => {
            const [amountOut, amountInMax, path, to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Swap up to'),
                getToken(path[0], amountInMax),
                getLabel('for'),
                getToken(ZeroAddress, amountOut),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        [iface.getFunction('swapExactTokensForETH')?.selector]: (accountOp, call) => {
            const [amountIn, amountOutMin, path, to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Swap'),
                getToken(path[0], amountIn),
                getLabel('for at least'),
                getToken(ZeroAddress, amountOutMin),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        [iface.getFunction('swapETHForExactTokens')?.selector]: (accountOp, call) => {
            const { args, value } = iface.parseTransaction(call) || { value: BigInt(0) };
            const [amountOut, path, to, deadline] = args || [];
            const outputAsset = path[path.length - 1];
            return [
                getAction('Swap up to'),
                getToken(ZeroAddress, value),
                getLabel('for'),
                getToken(outputAsset, amountOut),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        // Liquidity
        [iface.getFunction('addLiquidity')?.selector]: (accountOp, call) => {
            const [tokenA, tokenB, amountADesired, amountBDesired /* amountAMin */ /* amountBMin */, , , to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Add liquidity'),
                getToken(tokenA, amountADesired),
                getLabel('and'),
                getToken(tokenB, amountBDesired),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        [iface.getFunction('addLiquidityETH')?.selector]: (accountOp, call) => {
            const { args, value } = iface.parseTransaction(call) || { args: [], value: BigInt(0) };
            const [token, amountTokenDesired /* amountTokenMin */ /* amountETHMin */, , , to, deadline] = args;
            return [
                getAction('Add liquidity'),
                getToken(token, amountTokenDesired),
                getLabel('and'),
                getToken(ZeroAddress, value),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        [iface.getFunction('removeLiquidity')?.selector]: (accountOp, call) => {
            const [tokenA, tokenB /* liquidity */, , amountAMin, amountBMin, to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Remove liquidity'),
                getLabel('at least'),
                getToken(tokenA, amountAMin),
                getLabel('and'),
                getToken(tokenB, amountBMin),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        },
        [iface.getFunction('removeLiquidityETH')?.selector]: (accountOp, call) => {
            const [token /* liquidity */, , amountTokenMin, amountETHMin, to, deadline] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Remove liquidity'),
                getLabel('at least'),
                getToken(token, amountTokenMin),
                getLabel('and'),
                getToken(ZeroAddress, amountETHMin),
                ...getUniRecipientText(accountOp.accountAddr, to),
                getDeadline(deadline)
            ];
        }
        // NOTE: We currently do not support *WithPermit functions cause they require an ecrecover signature
        // Uniswap will detect we don't support it cause it will fail on requesting eth_signTypedData_v4
    };
};
export { uniV2Mapping };
//# sourceMappingURL=uniV2.js.map