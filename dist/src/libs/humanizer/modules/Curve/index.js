"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const Curve_1 = require("../../const/abis/Curve");
const utils_1 = require("../../utils");
const curveModule = (_, calls) => {
    const iface = new ethers_1.Interface(Curve_1.CurveRouter);
    const parseCurveNative = (address) => address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? ethers_1.ZeroAddress : address;
    const handleBasicSwap = (curveRoute, amountIn, amountOut) => {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const route = curveRoute.filter((a) => a !== ethers_1.ZeroAddress);
        const [inToken, outToken] = [route[0], route[route.length - 1]];
        return [
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)(parseCurveNative(inToken), amountIn),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)(parseCurveNative(outToken), amountOut)
        ];
    };
    const matcher = {
        [iface.getFunction('exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _expected, address[5] _pools)')?.selector]: (call) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const { _route, _amount, _expected } = iface.parseTransaction(call).args;
            return handleBasicSwap(_route, _amount, _expected);
        }
    };
    const newCalls = calls.map((call) => {
        if (call.fullVisualization || !matcher[call.data.slice(0, 10)])
            return call;
        return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) };
    });
    return newCalls;
};
exports.default = curveModule;
//# sourceMappingURL=index.js.map