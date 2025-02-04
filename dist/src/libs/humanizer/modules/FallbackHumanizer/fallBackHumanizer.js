/* eslint-disable no-await-in-loop */
import { Interface, isAddress, ZeroAddress } from 'ethers';
import { checkIfUnknownAction, getAction, getAddressVisualization, getLabel, getToken } from '../../utils';
function extractAddresses(data, _selector) {
    const selector = _selector.startsWith('function') ? _selector : `function ${_selector}`;
    const iface = new Interface([selector]);
    const args = iface.decodeFunctionData(selector, data);
    const deepSearchForAddress = (obj) => {
        return Object.values(obj)
            .map((o) => {
            if (typeof o === 'string' && isAddress(o))
                return [o];
            if (typeof o === 'object')
                return deepSearchForAddress(o).filter((x) => x);
            return undefined;
        })
            .filter((x) => x).flat();
    };
    return deepSearchForAddress(args);
}
export const fallbackHumanizer = (accountOp, currentIrCalls, humanizerMeta) => {
    const newCalls = currentIrCalls.map((call) => {
        if (call.fullVisualization && !checkIfUnknownAction(call?.fullVisualization))
            return call;
        const knownSigHashes = Object.values(humanizerMeta.abis).reduce((a, b) => ({ ...a, ...b }), {});
        const visualization = [];
        if (call.data !== '0x') {
            let extractedAddresses = [];
            if (knownSigHashes[call.data.slice(0, 10)]?.signature) {
                try {
                    extractedAddresses = extractAddresses(call.data, knownSigHashes[call.data.slice(0, 10)].signature);
                }
                catch (e) {
                    console.error('Humanizer: fallback: Could not decode addresses from calldata');
                }
                visualization.push(getAction(`Call ${
                //  from function asd(address asd) returns ... => asd(address asd)
                knownSigHashes[call.data.slice(0, 10)].signature
                    .split('function ')
                    .filter((x) => x !== '')[0]
                    .split(' returns')
                    .filter((x) => x !== '')[0]}`), getLabel('from'), getAddressVisualization(call.to), ...extractedAddresses.map((a) => ({ ...getToken(a, 0n), isHidden: true })));
            }
            else {
                visualization.push(getAction('Unknown action'), getLabel('to'), getAddressVisualization(call.to));
            }
        }
        if (call.value) {
            if (call.data !== '0x')
                visualization.push(getLabel('and'));
            visualization.push(getAction('Send'), getToken(ZeroAddress, call.value));
            if (call.data === '0x')
                visualization.push(getLabel('to'), getAddressVisualization(call.to));
        }
        return {
            ...call,
            fullVisualization: visualization.length
                ? visualization
                : [getAction('No data, no value, call to'), getAddressVisualization(call.to)]
        };
    });
    return newCalls;
};
//# sourceMappingURL=fallBackHumanizer.js.map