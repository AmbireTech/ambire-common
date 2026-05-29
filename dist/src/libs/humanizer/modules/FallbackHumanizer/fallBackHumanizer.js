"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fallbackHumanizer = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../../utils");
const fallbackHumanizer = (accountOp, currentIrCalls) => {
    const newCalls = currentIrCalls.map((call) => {
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
                let fullVisualization = call.fullVisualization || [
                    (0, utils_1.getAction)('Interacting'),
                    (0, utils_1.getLabel)('with'),
                    (0, utils_1.getAddressVisualization)(call.to)
                ];
                if (call.value &&
                    ![
                        'Swap',
                        'Bridge',
                        'Swap/Bridge',
                        'Supply',
                        'Deposit',
                        'Supply to vault',
                        'Wrap'
                    ].includes(fullVisualization[0]?.content || '')) {
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
    });
    return newCalls;
};
exports.fallbackHumanizer = fallbackHumanizer;
//# sourceMappingURL=fallBackHumanizer.js.map