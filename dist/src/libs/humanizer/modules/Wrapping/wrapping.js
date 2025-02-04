import { Interface, ZeroAddress } from 'ethers';
import { WETH } from '../../const/abis';
import { getUnknownVisualization, getUnwrapping, getWrapping } from '../../utils';
export const wrappingModule = (_, irCalls, humanizerMeta) => {
    const iface = new Interface(WETH);
    const newCalls = irCalls.map((call) => {
        const knownAddressData = humanizerMeta?.knownAddresses[call.to.toLowerCase()];
        if (knownAddressData?.name === 'Wrapped ETH' ||
            knownAddressData?.name === 'WETH' ||
            knownAddressData?.token?.symbol === 'WETH' ||
            knownAddressData?.name === 'WMATIC' ||
            knownAddressData?.token?.symbol === 'WMATIC' ||
            knownAddressData?.token?.symbol === 'WAVAX') {
            // 0xd0e30db0
            if (call.data.slice(0, 10) === iface.getFunction('deposit')?.selector) {
                return {
                    ...call,
                    fullVisualization: getWrapping(ZeroAddress, call.value)
                };
            }
            // 0x2e1a7d4d
            if (call.data.slice(0, 10) === iface.getFunction('withdraw')?.selector) {
                const [amount] = iface.parseTransaction(call)?.args || [];
                return {
                    ...call,
                    fullVisualization: getUnwrapping(ZeroAddress, amount)
                };
            }
            if (!call?.fullVisualization)
                return {
                    ...call,
                    fullVisualization: getUnknownVisualization('wrapped', call)
                };
        }
        return call;
    });
    return newCalls;
};
//# sourceMappingURL=wrapping.js.map