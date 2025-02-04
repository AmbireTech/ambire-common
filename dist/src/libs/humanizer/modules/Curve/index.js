import { Interface, ZeroAddress } from 'ethers';
import { CurveRouter } from '../../const/abis/Curve';
import { getAction, getLabel, getToken } from '../../utils';
const curveModule = (_, calls) => {
    const iface = new Interface(CurveRouter);
    const parseCurveNative = (address) => address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? ZeroAddress : address;
    const handleBasicSwap = (curveRoute, amountIn, amountOut) => {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const route = curveRoute.filter((a) => a !== ZeroAddress);
        const [inToken, outToken] = [route[0], route[route.length - 1]];
        return [
            getAction('Swap'),
            getToken(parseCurveNative(inToken), amountIn),
            getLabel('for'),
            getToken(parseCurveNative(outToken), amountOut)
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
export default curveModule;
//# sourceMappingURL=index.js.map