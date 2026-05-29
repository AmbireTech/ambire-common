import { Interface, ZeroAddress } from 'ethers';
import { UniV3Router, UniV3Router2 } from '../../const/abis';
import { getAction, getAddressVisualization, getDeadline, getLabel, getRecipientText, getToken } from '../../utils';
import { getUniRecipientText, parsePath, uniReduce } from './utils';
const ifaceV32 = new Interface(UniV3Router2);
const ifaceV3 = new Interface(UniV3Router);
const uniV3Mapping = () => {
    return {
        // 0x5ae401dc
        [ifaceV32.getFunction('multicall(uint256 deadline,bytes[])')?.selector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in uniswap humanizer when !call.to');
            const [deadline, calls] = ifaceV32.parseTransaction(call)?.args || [];
            const mappingResult = uniV3Mapping();
            const parsed = calls.map((data) => {
                const sigHash = data.slice(0, 10);
                const humanizer = mappingResult[sigHash];
                return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Uniswap action')];
            });
            const res = uniReduce(parsed);
            return res.length
                ? [...res, getDeadline(deadline)]
                : [getAction('Uniswap action'), getLabel('to'), getAddressVisualization(call.to)];
        },
        // 0xac9650d8
        [ifaceV32.getFunction('multicall(bytes[])')?.selector]: (accountOp, call) => {
            const [calls] = ifaceV32.parseTransaction(call)?.args || [];
            const mappingResult = uniV3Mapping();
            const parsed = calls.map((data) => {
                const sigHash = data.slice(0, 10);
                const humanizer = mappingResult[sigHash];
                return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Uniswap action')];
            });
            return uniReduce(parsed);
        },
        // 0x1f0464d1
        [ifaceV32.getFunction('multicall(bytes32 prevBlockHash, bytes[])')?.selector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in uniswap humanizer when !call.to');
            const [, calls] = ifaceV32.parseTransaction(call)?.args || [];
            const mappingResult = uniV3Mapping();
            const parsed = calls.map((data) => {
                const sigHash = data.slice(0, 10);
                const humanizer = mappingResult[sigHash];
                return humanizer ? humanizer(accountOp, { ...call, data }) : [getAction('Uniswap action')];
            });
            return parsed.length
                ? uniReduce(parsed)
                : [getAction('Uniswap action'), getLabel('to'), getAddressVisualization(call.to)];
        },
        // NOTE: selfPermit is not supported cause it requires an ecrecover signature
        // 0x04e45aaf
        [ifaceV32.getFunction('exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            // @TODO: consider fees
            return [
                getAction('Swap'),
                getToken(params.tokenIn, 0n),
                getLabel('for'),
                getToken(params.tokenOut, 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient)
            ];
        },
        // 0x414bf389
        [ifaceV32.getFunction('exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Swap'),
                getToken(params.tokenIn, 0n),
                getLabel('for'),
                getToken(params.tokenOut, 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient),
                getDeadline(params.deadline)
            ];
        },
        // 0xb858183f
        [ifaceV32.getFunction('exactInput')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            const path = parsePath(params.path);
            if (!path.length)
                return [];
            return [
                getAction('Swap'),
                getToken(path[0], 0n),
                getLabel('for'),
                getToken(path[path.length - 1], 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient)
            ];
        },
        // 0x5023b4df
        [ifaceV32.getFunction('exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params)')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Swap'),
                getToken(params.tokenIn, 0n),
                getLabel('for'),
                getToken(params.tokenOut, 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient)
            ];
        },
        // 0xdb3e2198
        [ifaceV32.getFunction('exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params)')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Swap'),
                getToken(params.tokenIn, 0n),
                getLabel('for'),
                getToken(params.tokenOut, 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient),
                getDeadline(params.deadline)
            ];
        },
        // 0x12210e8a
        [ifaceV32.getFunction('refundETH()')?.selector]: (accountOp, call) => {
            return [getAction('Withdraw'), getToken(ZeroAddress, call.value)];
        },
        // 0x09b81346
        [ifaceV32.getFunction('exactOutput')?.selector]: (accountOp, call) => {
            const [params] = ifaceV32.parseTransaction(call)?.args || [];
            const path = parsePath(params.path);
            if (!path.length)
                return [];
            return [
                getAction('Swap'),
                getToken(path[path.length - 1], 0n),
                getLabel('for'),
                getToken(path[0], 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient)
            ];
        },
        // 0x42712a67
        [ifaceV32.getFunction('swapTokensForExactTokens')?.selector]: (accountOp, call) => {
            const [amountOut, amountInMax, path, to] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Swap'),
                getToken(path[0], 0n),
                getLabel('for'),
                getToken(path[path.length - 1], 0n),
                ...getUniRecipientText(accountOp.accountAddr, to)
            ];
        },
        // 0x472b43f3
        [ifaceV32.getFunction('swapExactTokensForTokens')?.selector]: (accountOp, call) => {
            const [amountIn, amountOutMin, path, to] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Swap'),
                getToken(path[0], 0n),
                getLabel('for'),
                getToken(path[path.length - 1], 0n),
                ...getUniRecipientText(accountOp.accountAddr, to)
            ];
        },
        // 0x49616997
        [ifaceV32.getFunction('unwrapWETH9(uint256)')?.selector]: (_accountOp, call) => {
            const [amountMin] = ifaceV32.parseTransaction(call)?.args || [];
            return [getAction('Unwrap'), getToken(ZeroAddress, 0n)];
        },
        // 0x49404b7c
        [ifaceV32.getFunction('unwrapWETH9(uint256,address recipient)')?.selector]: (accountOp, call) => {
            const [amountMin, recipient] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Unwrap'),
                getToken(ZeroAddress, 0n),
                ...getUniRecipientText(accountOp.accountAddr, recipient)
            ];
        },
        // 0xe90a182f
        [ifaceV32.getFunction('sweepToken(address,uint256)')?.selector]: (_accountOp, call) => {
            const [token, amountMinimum] = ifaceV32.parseTransaction(call)?.args || [];
            return [getAction('Sweep'), getToken(token, 0n)];
        },
        // 0xdf2ab5bb
        [ifaceV32.getFunction('sweepToken(address,uint256,address)')?.selector]: (accountOp, call) => {
            const [token, amountMinimum, recipient] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Sweep'),
                getToken(token, 0n),
                ...getUniRecipientText(accountOp.accountAddr, recipient)
            ];
        },
        // 0x3068c554
        [ifaceV32.getFunction('sweepTokenWithFee(address,uint256,uint256,address)')?.selector]: (_accountOp, call) => {
            const [token, amountMinimum, feeBips, feeRecipient] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Sweep'),
                getToken(token, 0n),
                getLabel('with fee'),
                getToken(token, feeBips),
                getLabel('to'),
                getAddressVisualization(feeRecipient)
            ];
        },
        // 0xe0e189a0
        [`${ifaceV32.getFunction('sweepTokenWithFee(address,uint256,address,uint256,address)')?.selector}`]: (accountOp, call) => {
            const [token, amountMinimum, recipient, feeBips, feeRecipient] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Sweep'),
                getToken(token, 0n),
                getLabel('with fee'),
                getToken(token, feeBips),
                getLabel('to'),
                getAddressVisualization(feeRecipient),
                ...getUniRecipientText(accountOp.accountAddr, recipient)
            ];
        },
        // 0x88316456
        [`${ifaceV32.getFunction('mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))')?.selector}`]: (accountOp, call) => {
            const [[token0, token1, 
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            fee, 
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            tickLower, 
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            tickUpper, amount0Desired, amount1Desired, 
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            amount0Min, 
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            amount1Min, recipient, deadline]] = ifaceV32.parseTransaction(call)?.args || [];
            return [
                getAction('Add liquidity'),
                getToken(token0, amount0Desired),
                getToken(token1, amount1Desired),
                getLabel('pair'),
                ...getRecipientText(accountOp.accountAddr, recipient),
                getDeadline(deadline)
            ];
        },
        // -------------------------------------------------------------------------------------------------
        // NOTE: selfPermit is not supported cause it requires an ecrecover signature
        // 0xc04b8d59
        [ifaceV3.getFunction('exactInput')?.selector]: (accountOp, call) => {
            const [params] = ifaceV3.parseTransaction(call)?.args || [];
            const path = parsePath(params.path);
            if (!path.length)
                return [];
            return [
                getAction('Swap'),
                getToken(path[0], 0n),
                getLabel('for'),
                getToken(path[path.length - 1], 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient),
                getDeadline(params.deadline)
            ];
        },
        // 0xf28c0498
        [ifaceV3.getFunction('exactOutput')?.selector]: (accountOp, call) => {
            const [params] = ifaceV3.parseTransaction(call)?.args || [];
            const path = parsePath(params.path);
            if (!path.length)
                return [];
            return [
                getAction('Swap'),
                getToken(path[path.length - 1], 0n),
                getLabel('for'),
                getToken(path[0], 0n),
                ...getUniRecipientText(accountOp.accountAddr, params.recipient),
                getDeadline(params.deadline)
            ];
        },
        // 0x9b2c0a37
        [ifaceV3.getFunction('unwrapWETH9WithFee')?.selector]: (accountOp, call) => {
            const [amountMin, recipient, feeBips, feeRecipient] = ifaceV3.parseTransaction(call)?.args || [];
            return [
                getAction('Unwrap'),
                getToken(ZeroAddress, 0n),
                getLabel('with fee'),
                getToken(ZeroAddress, feeBips),
                getLabel('to'),
                getAddressVisualization(feeRecipient),
                ...getUniRecipientText(accountOp.accountAddr, recipient)
            ];
        }
    };
};
export { uniV3Mapping };
//# sourceMappingURL=uniV3.js.map