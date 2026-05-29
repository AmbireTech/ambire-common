import { getAction, getAddressVisualization, getLabel } from '../../utils';
const LIFI_ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
// const iface = new Interface(Lifi)
export const LifiModule = (accountOp, irCalls) => {
    const newCalls = irCalls.map((call) => {
        if (call.to && call.to.toLowerCase() === LIFI_ROUTER.toLowerCase()) {
            return {
                ...call,
                fullVisualization: [
                    getAction('Swap/Bridge'),
                    getLabel('with'),
                    getAddressVisualization(call.to)
                ]
            };
        }
        return call;
    });
    return newCalls;
};
//# sourceMappingURL=lifiModule.js.map