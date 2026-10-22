"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensModule = void 0;
const viem_1 = require("viem");
const coinType_1 = require("../../const/coinType");
const utils_1 = require("../../utils");
const ENS_CONTROLLER = '0x253553366Da8546fC250F225fe3d25d0C782303b';
const ENS_RESOLVER = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63';
const BULK_RENEWAL = '0xa12159e5131b1eEf6B4857EEE3e1954744b5033A';
const registerAbi = (0, viem_1.parseAbi)([
    'function register(string name,address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses)'
]);
const commitAbi = (0, viem_1.parseAbi)(['function commit(bytes32)']);
const setTextAbi = (0, viem_1.parseAbi)([
    'function setText(bytes32 node,string calldata key,string calldata value)'
]);
const multicallAbi = (0, viem_1.parseAbi)(['function multicall(bytes[] data)']);
const setAddrAbi = (0, viem_1.parseAbi)(['function setAddr(bytes32 node, uint256 coinType, bytes memory a)']);
const setContenthashAbi = (0, viem_1.parseAbi)(['function setContenthash(bytes32,bytes)']);
const setABIAbi = (0, viem_1.parseAbi)(['function setABI(bytes32,uint256,bytes)']);
const renewAbi = (0, viem_1.parseAbi)(['function renew(string id,uint256 duration)']);
const renewAllAbi = (0, viem_1.parseAbi)(['function renewAll(string[] calldata names, uint256 duration)']);
const YEAR_IN_SECONDS = 60n * 60n * 24n * 365n;
const getDurationText = (duration) => {
    const durationLabel = `${duration / YEAR_IN_SECONDS} year${duration < 2n * YEAR_IN_SECONDS ? '' : 's'}`;
    return durationLabel;
};
const registerSelector = (0, viem_1.toFunctionSelector)(registerAbi[0]);
const renewSelector = (0, viem_1.toFunctionSelector)(renewAbi[0]);
const commitSelector = (0, viem_1.toFunctionSelector)(commitAbi[0]);
const setTextSelector = (0, viem_1.toFunctionSelector)(setTextAbi[0]);
const setAddrSelector = (0, viem_1.toFunctionSelector)(setAddrAbi[0]);
const setContenthashSelector = (0, viem_1.toFunctionSelector)(setContenthashAbi[0]);
const setABISelector = (0, viem_1.toFunctionSelector)(setABIAbi[0]);
const multicallSelector = (0, viem_1.toFunctionSelector)(multicallAbi[0]);
const renewAllSelector = (0, viem_1.toFunctionSelector)(renewAllAbi[0]);
const ensModule = (accountOp, call) => {
    // @TODO: set text and others
    if (!(0, utils_1.isHexCall)(call))
        return call;
    if (call.to && call.to.toLowerCase() === ENS_CONTROLLER.toLowerCase()) {
        if (call.data.slice(0, 10) === registerSelector) {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: registerAbi, data: call.data });
            const [name, owner, duration] = args;
            const fullVisualization = [(0, utils_1.getAction)('Register'), (0, utils_1.getLabel)(`${name}.ens`, true)];
            if (owner !== accountOp.accountAddr)
                fullVisualization.push((0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(owner));
            const durationLabel = getDurationText(duration);
            fullVisualization.push((0, utils_1.getLabel)('for'), (0, utils_1.getLabel)(durationLabel, true));
            return { ...call, fullVisualization };
        }
        if (call.data.slice(0, 10) === renewSelector) {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: renewAbi, data: call.data });
            const [id, duration] = args;
            const durationLabel = getDurationText(duration);
            const fullVisualization = [
                (0, utils_1.getAction)('Renew'),
                (0, utils_1.getLabel)(`${id}.eth`),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getLabel)(durationLabel, true)
            ];
            return { ...call, fullVisualization };
        }
        if (call.data.slice(0, 10) === commitSelector) {
            return {
                ...call,
                fullVisualization: [(0, utils_1.getAction)('Request'), (0, utils_1.getLabel)('to register an ENS record')]
            };
        }
    }
    const resolverMatcher = {
        [setTextSelector]: (data) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: setTextAbi, data });
            const [, key, value] = args;
            return [(0, utils_1.getAction)('Set'), (0, utils_1.getLabel)(`${key} to`), (0, utils_1.getLabel)(value, true)];
        },
        [setAddrSelector]: (data) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: setAddrAbi, data });
            const [, coinType, a] = args;
            const ct = coinType_1.registeredCoinTypes[Number(coinType)];
            const networkName = (ct && ct[2]) || 'Unknown network';
            return networkName === 'Ether'
                ? [
                    (0, utils_1.getAction)('Transfer ENS'),
                    (0, utils_1.getLabel)('to'),
                    (0, viem_1.isAddress)(a) ? (0, utils_1.getAddressVisualization)(a) : (0, utils_1.getLabel)(a, true)
                ]
                : [
                    (0, utils_1.getAction)('Set'),
                    (0, utils_1.getLabel)('address'),
                    (0, viem_1.isAddress)(a) ? (0, utils_1.getAddressVisualization)(a) : (0, utils_1.getLabel)(a, true),
                    (0, utils_1.getLabel)('on'),
                    (0, utils_1.getLabel)(networkName, true)
                ];
        },
        [setContenthashSelector]: () => {
            return [(0, utils_1.getAction)('Update'), (0, utils_1.getLabel)('data')];
        },
        [setABISelector]: () => {
            return [(0, utils_1.getAction)('Set'), (0, utils_1.getLabel)('ABI')];
        }
    };
    if (call.to && call.to.toLowerCase() === ENS_RESOLVER.toLowerCase()) {
        const resolverHandler = resolverMatcher[call.data.slice(0, 10)];
        if (resolverHandler)
            return { ...call, fullVisualization: resolverHandler(call.data) };
        if (call.data.slice(0, 10) === multicallSelector) {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: multicallAbi, data: call.data });
            const [data] = args;
            const separator = (0, utils_1.getLabel)('and');
            const fullVisualization = data
                .map((i) => {
                const handler = resolverMatcher[i.slice(0, 10)];
                return handler ? handler(i) : [(0, utils_1.getAction)('Unknown ENS action')];
            })
                .reduce((acc, curr, index) => acc.concat(index ? [separator, ...curr] : curr), []);
            return { ...call, fullVisualization };
        }
    }
    if (call.to &&
        call.to.toLowerCase() === BULK_RENEWAL.toLowerCase() &&
        call.data.startsWith(renewAllSelector)) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: renewAllAbi, data: call.data });
        const [names, duration] = args;
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
};
exports.ensModule = ensModule;
//# sourceMappingURL=index.js.map