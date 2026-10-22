"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fallbackHumanizer = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const humanizerInfo_json_1 = tslib_1.__importDefault(require("../../../../consts/humanizer/humanizerInfo.json"));
const utils_1 = require("../../utils");
const fallbackHumanizer = (accountOp, call) => {
    const dataKey = !call.data || call.data === '0x' ? 'no-data' : 'has-data';
    const valueKey = call.value ? 'has-value' : 'no-value';
    const toKey = call.to ? 'has-to' : 'no-to';
    switch (`${toKey}:${valueKey}:${dataKey}`) {
        case 'no-to:no-value:no-data':
        case 'no-to:no-value:has-data':
            return { ...call, fullVisualization: [(0, utils_1.getAction)('Deploy'), (0, utils_1.getLabel)('contract')] };
        case 'no-to:has-value:no-data':
        case 'no-to:has-value:has-data':
            return {
                ...call,
                fullVisualization: [
                    (0, utils_1.getAction)('Deploy'),
                    (0, utils_1.getLabel)('contract'),
                    (0, utils_1.getLabel)('and'),
                    (0, utils_1.getAction)('Burn', { warning: true }),
                    (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value)
                ]
            };
        case 'has-to:no-value:no-data':
            // preserve a visualization already set by an earlier, more specific module (e.g. a
            // Safe{WALLET} "cancel queued transaction" call) instead of unconditionally overwriting
            // it with a generic "Empty call to" label below
            if (call.fullVisualization)
                return call;
            return {
                ...call,
                fullVisualization: [(0, utils_1.getAction)('Empty call to'), (0, utils_1.getAddressVisualization)(call.to)]
            };
        case 'has-to:has-value:no-data':
            return {
                ...call,
                fullVisualization: [
                    (0, utils_1.getAction)('Send'),
                    (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(call.to)
                ]
            };
        case 'has-to:no-value:has-data':
        case 'has-to:has-value:has-data':
            const knownFunctionName = (0, utils_1.getKnownFunctionName)(humanizerInfo_json_1.default, call.data.slice(0, 10));
            const capitalizedFunctionName = knownFunctionName
                ? `${knownFunctionName.charAt(0).toUpperCase()}${knownFunctionName.slice(1)}`
                : undefined;
            let fullVisualization = call.fullVisualization ||
                (capitalizedFunctionName
                    ? [(0, utils_1.getAction)(capitalizedFunctionName), (0, utils_1.getLabel)('on'), (0, utils_1.getAddressVisualization)(call.to)]
                    : [(0, utils_1.getAction)('Interacting'), (0, utils_1.getLabel)('with'), (0, utils_1.getAddressVisualization)(call.to)]);
            if (call.value &&
                !['Swap', 'Bridge', 'Swap/Bridge', 'Supply', 'Deposit', 'Supply to vault', 'Wrap'].includes(fullVisualization[0]?.content || '')) {
                fullVisualization = [
                    (0, utils_1.getAction)('Send'),
                    (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value),
                    (0, utils_1.getLabel)('and'),
                    ...fullVisualization
                ];
            }
            return {
                ...call,
                isFallback: !call.fullVisualization,
                fullVisualization
            };
        default:
            return { ...call, fullVisualization: [(0, utils_1.getAction)('Empty call')] };
    }
};
exports.fallbackHumanizer = fallbackHumanizer;
//# sourceMappingURL=fallBackHumanizer.js.map