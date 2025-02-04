import { ZeroAddress } from 'ethers';
import { getToken } from '../../utils';
export const postProcessing = (_, currentIrCalls) => {
    const newCalls = currentIrCalls.map((_call) => {
        const fullVisualization = (_call?.fullVisualization || []).map((i) => {
            if (i.type === 'token' && i.address.toLowerCase() === '0x'.padEnd(42, 'e'))
                return { ...i, address: ZeroAddress };
            return i;
        });
        return {
            ..._call,
            fullVisualization: [...fullVisualization, getToken(_call.to, 0n, true)]
        };
    });
    return newCalls;
};
//# sourceMappingURL=postProcessModule.js.map