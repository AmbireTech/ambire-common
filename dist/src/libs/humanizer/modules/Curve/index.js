"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const exchangeAbi = (0, viem_1.parseAbi)([
    'function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _expected, address[5] _pools)'
]);
const exchangeSelector = (0, viem_1.toFunctionSelector)(exchangeAbi[0]);
const curveModule = (_, call) => {
    const parseCurveNative = (address) => address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? viem_1.zeroAddress : address;
    const handleBasicSwap = (curveRoute, amountIn, amountOut) => {
        const route = curveRoute.filter((a) => a !== viem_1.zeroAddress);
        const [inToken, outToken] = [route[0], route[route.length - 1]];
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(parseCurveNative(inToken), amountIn),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(parseCurveNative(outToken), amountOut)
        ];
    };
    const matcher = {
        [exchangeSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: exchangeAbi, data: call.data });
            const [_route, , _amount, _expected] = args;
            return handleBasicSwap(_route, _amount, _expected);
        }
    };
    const match = matcher[call.data.slice(0, 10)];
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call) || !match)
        return call;
    return { ...call, fullVisualization: match(call) };
};
exports.default = curveModule;
//# sourceMappingURL=index.js.map