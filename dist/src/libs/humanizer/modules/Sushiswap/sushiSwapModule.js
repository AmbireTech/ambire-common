"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sushiSwapModule = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const processRouteAbi = (0, viem_1.parseAbi)([
    'function processRoute(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOutMin, address to, bytes route) payable returns (uint256 amountOut)'
]);
const processRouteSelector = (0, viem_1.toFunctionSelector)(processRouteAbi[0]);
const sushiSwapModule = (accountOp, call) => {
    const matcher = {
        [processRouteSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: processRouteAbi, data: call.data });
            const [tokenInRaw, amountIn, tokenOutRaw, amountOutMin, to] = args;
            const tokenIn = (0, utils_1.eToNative)(tokenInRaw);
            const tokenOut = (0, utils_1.eToNative)(tokenOutRaw);
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
    if (!(0, utils_1.isHexCall)(call))
        return call;
    const match = matcher[call.data.slice(0, 10)];
    if (!match)
        return call;
    return match(call);
};
exports.sushiSwapModule = sushiSwapModule;
//# sourceMappingURL=sushiSwapModule.js.map