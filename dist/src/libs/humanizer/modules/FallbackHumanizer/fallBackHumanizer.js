"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fallbackHumanizer = void 0;
/* eslint-disable no-await-in-loop */
const ethers_1 = require("ethers");
const utils_1 = require("../../utils");
function extractAddresses(data, _selector) {
    const selector = _selector.startsWith('function') ? _selector : `function ${_selector}`;
    const iface = new ethers_1.Interface([selector]);
    const args = iface.decodeFunctionData(selector, data);
    const deepSearchForAddress = (obj) => {
        return Object.values(obj)
            .map((o) => {
            if (typeof o === 'string' && (0, ethers_1.isAddress)(o))
                return [o];
            if (typeof o === 'object')
                return deepSearchForAddress(o).filter((x) => x);
            return undefined;
        })
            .filter((x) => x).flat();
    };
    return deepSearchForAddress(args);
}
const fallbackHumanizer = (accountOp, currentIrCalls, humanizerMeta) => {
    const newCalls = currentIrCalls.map((call) => {
        if (call.fullVisualization && !(0, utils_1.checkIfUnknownAction)(call?.fullVisualization))
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
                visualization.push((0, utils_1.getAction)(`Call ${
                //  from function asd(address asd) returns ... => asd(address asd)
                knownSigHashes[call.data.slice(0, 10)].signature
                    .split('function ')
                    .filter((x) => x !== '')[0]
                    .split(' returns')
                    .filter((x) => x !== '')[0]}`), (0, utils_1.getLabel)('from'), (0, utils_1.getAddressVisualization)(call.to), ...extractedAddresses.map((a) => ({ ...(0, utils_1.getToken)(a, 0n), isHidden: true })));
            }
            else {
                visualization.push((0, utils_1.getAction)('Unknown action'), (0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(call.to));
            }
        }
        if (call.value) {
            if (call.data !== '0x')
                visualization.push((0, utils_1.getLabel)('and'));
            visualization.push((0, utils_1.getAction)('Send'), (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value));
            if (call.data === '0x')
                visualization.push((0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(call.to));
        }
        return {
            ...call,
            fullVisualization: visualization.length
                ? visualization
                : [(0, utils_1.getAction)('No data, no value, call to'), (0, utils_1.getAddressVisualization)(call.to)]
        };
    });
    return newCalls;
};
exports.fallbackHumanizer = fallbackHumanizer;
//# sourceMappingURL=fallBackHumanizer.js.map