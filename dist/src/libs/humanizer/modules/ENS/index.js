"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensModule = void 0;
const ethers_1 = require("ethers");
const coinType_1 = require("../../const/coinType");
const utils_1 = require("../../utils");
const ENS_CONTROLLER = '0x253553366Da8546fC250F225fe3d25d0C782303b';
const ENS_RESOLVER = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63';
const BULK_RENEWAL = '0xa12159e5131b1eEf6B4857EEE3e1954744b5033A';
const iface = new ethers_1.Interface([
    'function register(string name,address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses)',
    'function commit(bytes32)',
    'function setText(bytes32 node,string calldata key,string calldata value)',
    'function multicall(bytes[] data)',
    // 'function setAddr(bytes32,uint256,bytes)',
    'function setAddr(bytes32 node, uint256 coinType, bytes memory a)',
    'function setContenthash(bytes32,bytes)',
    'function setABI(bytes32,uint256,bytes)',
    'function renew(string id,uint256 duration)',
    'function renewAll(string[] calldata names, uint256 duration)'
]);
const YEAR_IN_SECONDS = 60n * 60n * 24n * 365n;
const getDurationText = (duration) => {
    const durationLabel = `${duration / YEAR_IN_SECONDS} year${duration < 2n * YEAR_IN_SECONDS ? '' : 's'}`;
    return durationLabel;
};
const ensModule = (accountOp, irCalls) => {
    // @TODO: set text and others
    return irCalls.map((call) => {
        if ((0, ethers_1.getAddress)(call.to) === ENS_CONTROLLER) {
            if (call.data.slice(0, 10) === iface.getFunction('register').selector) {
                const { name, owner, duration
                // secret,
                // resolver,
                // data,
                // reverseRecord,
                // ownerControlledFuses
                 } = iface.decodeFunctionData('register', call.data);
                const fullVisualization = [(0, utils_1.getAction)('Register'), (0, utils_1.getLabel)(`${name}.ens`, true)];
                if (owner !== accountOp.accountAddr)
                    fullVisualization.push((0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(owner));
                const durationLabel = getDurationText(duration);
                fullVisualization.push((0, utils_1.getLabel)('for'), (0, utils_1.getLabel)(durationLabel, true));
                return { ...call, fullVisualization };
            }
            if (call.data.slice(0, 10) === iface.getFunction('renew').selector) {
                const { id, duration } = iface.decodeFunctionData('renew', call.data);
                const durationLabel = getDurationText(duration);
                const fullVisualization = [
                    (0, utils_1.getAction)('Renew'),
                    (0, utils_1.getLabel)(`${id}.eth`),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getLabel)(durationLabel, true)
                ];
                return { ...call, fullVisualization };
            }
            if (call.data.slice(0, 10) === iface.getFunction('commit').selector) {
                return {
                    ...call,
                    fullVisualization: [(0, utils_1.getAction)('Request'), (0, utils_1.getLabel)('to register an ENS record')]
                };
            }
        }
        const resolverMatcher = {
            [iface.getFunction('setText').selector]: (data) => {
                const { 
                // node,
                key, value } = iface.decodeFunctionData('setText', data);
                return [(0, utils_1.getAction)('Set'), (0, utils_1.getLabel)(`${key} to`), (0, utils_1.getLabel)(value, true)];
            },
            [iface.getFunction('setAddr').selector]: (data) => {
                const { 
                // node,
                coinType, a } = iface.decodeFunctionData('setAddr', data);
                const ct = coinType_1.registeredCoinTypes[Number(coinType)];
                const networkName = (ct && ct[2]) || 'Unknown network';
                return networkName === 'Ether'
                    ? [
                        (0, utils_1.getAction)('Transfer ENS'),
                        (0, utils_1.getLabel)('to'),
                        (0, ethers_1.isAddress)(a) ? (0, utils_1.getAddressVisualization)(a) : (0, utils_1.getLabel)(a, true)
                    ]
                    : [
                        (0, utils_1.getAction)('Set'),
                        (0, utils_1.getLabel)('address'),
                        (0, ethers_1.isAddress)(a) ? (0, utils_1.getAddressVisualization)(a) : (0, utils_1.getLabel)(a, true),
                        (0, utils_1.getLabel)('on'),
                        (0, utils_1.getLabel)(networkName, true)
                    ];
            },
            [iface.getFunction('setContenthash').selector]: () => {
                return [(0, utils_1.getAction)('Update'), (0, utils_1.getLabel)('data')];
            },
            [iface.getFunction('setABI').selector]: () => {
                return [(0, utils_1.getAction)('Set'), (0, utils_1.getLabel)('ABI')];
            }
        };
        if ((0, ethers_1.getAddress)(call.to) === ENS_RESOLVER) {
            if (resolverMatcher[call.data.slice(0, 10)])
                return { ...call, fullVisualization: resolverMatcher[call.data.slice(0, 10)](call.data) };
            if (call.data.slice(0, 10) === iface.getFunction('multicall').selector) {
                const { data } = iface.decodeFunctionData('multicall', call.data);
                const separator = (0, utils_1.getLabel)('and');
                const fullVisualization = data
                    .map((i) => {
                    return resolverMatcher[i.slice(0, 10)]
                        ? resolverMatcher[i.slice(0, 10)](i)
                        : [(0, utils_1.getAction)('Unknown ENS action')];
                })
                    .reduce((acc, curr, index) => acc.concat(index ? [separator, ...curr] : curr), []);
                return { ...call, fullVisualization };
            }
        }
        if ((0, ethers_1.getAddress)(call.to) === BULK_RENEWAL &&
            call.data.startsWith(iface.getFunction('renewAll').selector)) {
            const { names, duration } = iface.decodeFunctionData('renewAll', call.data);
            const durationLabel = getDurationText(duration);
            return {
                ...call,
                fullVisualization: [
                    (0, utils_1.getAction)('Renew'),
                    ...names.map((name) => (0, utils_1.getLabel)(`${name}.eth`, true)),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getLabel)(durationLabel, true)
                ]
            };
        }
        return call;
    });
};
exports.ensModule = ensModule;
//# sourceMappingURL=index.js.map