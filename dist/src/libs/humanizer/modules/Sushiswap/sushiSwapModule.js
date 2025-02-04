import { Interface, ZeroAddress } from 'ethers';
import { RouteProcessor } from '../../const/abis';
import { getAction, getLabel, getRecipientText, getToken } from '../../utils';
export const sushiSwapModule = (accountOp, irCalls) => {
    const routeProcessorIface = new Interface(RouteProcessor);
    const matcher = {
        [`${routeProcessorIface.getFunction('processRoute')?.selector}`]: (_accountOp, call) => {
            const params = routeProcessorIface.parseTransaction(call).args;
            let { tokenIn, tokenOut /* route */ } = params;
            const { amountIn, amountOutMin, to } = params;
            if (tokenIn.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
                tokenIn = ZeroAddress;
            if (tokenOut.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
                tokenOut = ZeroAddress;
            return {
                ...call,
                fullVisualization: [
                    getAction('Swap'),
                    getToken(tokenIn, amountIn),
                    getLabel('for'),
                    getToken(tokenOut, amountOutMin),
                    ...getRecipientText(accountOp.accountAddr, to)
                ]
            };
        }
    };
    const newCalls = irCalls.map((call) => {
        if (matcher[call.data.slice(0, 10)]) {
            return matcher[call.data.slice(0, 10)](accountOp, call);
        }
        return call;
    });
    return newCalls;
};
//# sourceMappingURL=sushiSwapModule.js.map