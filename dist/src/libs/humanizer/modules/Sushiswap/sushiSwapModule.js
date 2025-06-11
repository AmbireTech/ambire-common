"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sushiSwapModule = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const sushiSwapModule = (accountOp, irCalls) => {
    const routeProcessorIface = new ethers_1.Interface(abis_1.RouteProcessor);
    const matcher = {
        [`${routeProcessorIface.getFunction('processRoute')?.selector}`]: (_accountOp, call) => {
            const params = routeProcessorIface.parseTransaction(call).args;
            let { tokenIn, tokenOut /* route */ } = params;
            const { amountIn, amountOutMin, to } = params;
            if (tokenIn.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
                tokenIn = ethers_1.ZeroAddress;
            if (tokenOut.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
                tokenOut = ethers_1.ZeroAddress;
            return {
                ...call,
                fullVisualization: [
                    (0, utils_1.getAction)('Swap'),
                    (0, utils_1.getToken)(tokenIn, amountIn),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(tokenOut, amountOutMin),
                    ...(0, utils_1.getRecipientText)(accountOp.accountAddr, to)
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
exports.sushiSwapModule = sushiSwapModule;
//# sourceMappingURL=sushiSwapModule.js.map