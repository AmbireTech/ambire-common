"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LidoModule = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const WRAPPED_ST_ETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const ST_ETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
const UNWRAP_CONTRACT_ADDR = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1';
const wrapAbi = (0, viem_1.parseAbi)(['function wrap(uint256 _stETHAmount) returns (uint256)']);
const unwrapAbi = (0, viem_1.parseAbi)(['function unwrap(uint256 _wstETHAmount) returns (uint256)']);
const requestWithdrawalsAbi = (0, viem_1.parseAbi)([
    'function requestWithdrawals(uint256[] _amounts, address _owner) returns (uint256[] requestIds)'
]);
const claimWithdrawalsAbi = (0, viem_1.parseAbi)([
    'function claimWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints)'
]);
const claimWithdrawalsToAbi = (0, viem_1.parseAbi)([
    'function claimWithdrawalsTo(uint256[] calldata _requestIds, uint256[] calldata _hints, address _recipient)'
]);
const claimWithdrawalAbi = (0, viem_1.parseAbi)(['function claimWithdrawal(uint256 _requestId)']);
const submitAbi = (0, viem_1.parseAbi)(['function submit(address _referral) payable returns (uint256)']);
const wrapSelector = (0, viem_1.toFunctionSelector)(wrapAbi[0]);
const unwrapSelector = (0, viem_1.toFunctionSelector)(unwrapAbi[0]);
const requestWithdrawalsSelector = (0, viem_1.toFunctionSelector)(requestWithdrawalsAbi[0]);
const claimWithdrawalsSelector = (0, viem_1.toFunctionSelector)(claimWithdrawalsAbi[0]);
const claimWithdrawalSelector = (0, viem_1.toFunctionSelector)(claimWithdrawalAbi[0]);
const claimWithdrawalsToSelector = (0, viem_1.toFunctionSelector)(claimWithdrawalsToAbi[0]);
const submitSelector = (0, viem_1.toFunctionSelector)(submitAbi[0]);
const LidoModule = (accOp, call) => {
    if (!(0, utils_1.isHexCall)(call))
        return call;
    if (call.to && (0, viem_1.isAddress)(call.to) && (0, viem_1.getAddress)(call.to) === WRAPPED_ST_ETH_ADDRESS) {
        if (call.data.startsWith(wrapSelector)) {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: wrapAbi, data: call.data });
            const [amount] = args;
            const fullVisualization = [(0, utils_1.getAction)('Wrap'), (0, utils_1.getToken)(ST_ETH_ADDRESS, amount)];
            return { ...call, fullVisualization };
        }
        if (call.data.startsWith(unwrapSelector)) {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: unwrapAbi, data: call.data });
            const [amount] = args;
            const fullVisualization = [(0, utils_1.getAction)('Unwrap'), (0, utils_1.getToken)(ST_ETH_ADDRESS, amount)];
            return { ...call, fullVisualization };
        }
    }
    if (call.to && (0, viem_1.isAddress)(call.to) && (0, viem_1.getAddress)(call.to) === UNWRAP_CONTRACT_ADDR) {
        if (call.data.startsWith(requestWithdrawalsSelector)) {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: requestWithdrawalsAbi,
                data: call.data
            });
            const [_amounts, _owner] = args;
            const amount = _amounts.reduce((acc, cur) => acc + cur, 0n);
            const fullVisualization = [(0, utils_1.getAction)('Request withdraw'), (0, utils_1.getToken)(ST_ETH_ADDRESS, amount)];
            if (![viem_1.zeroAddress, accOp.accountAddr.toLowerCase()].includes(_owner.toLowerCase()))
                fullVisualization.push((0, utils_1.getLabel)('and authorize'), (0, utils_1.getAddressVisualization)(_owner));
            return { ...call, fullVisualization };
        }
        if (call.data.startsWith(claimWithdrawalsSelector)) {
            return { ...call, fullVisualization: [(0, utils_1.getAction)('Claim withdrawals')] };
        }
        if (call.data.startsWith(claimWithdrawalSelector)) {
            return { ...call, fullVisualization: [(0, utils_1.getAction)('Claim withdrawal')] };
        }
        if (call.data.startsWith(claimWithdrawalsToSelector)) {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: claimWithdrawalsToAbi,
                data: call.data
            });
            const [, , _recipient] = args;
            const fullVisualization = [(0, utils_1.getAction)('Claim withdrawal')];
            if (_recipient.toLowerCase() !== accOp.accountAddr.toLowerCase())
                fullVisualization.push((0, utils_1.getLabel)('and send to'), (0, utils_1.getAddressVisualization)(_recipient));
            return { ...call, fullVisualization: [(0, utils_1.getAction)('Claim withdrawal')] };
        }
    }
    else if (call.to && (0, viem_1.isAddress)(call.to) && (0, viem_1.getAddress)(call.to) === ST_ETH_ADDRESS) {
        if (call.data.startsWith(submitSelector)) {
            return {
                ...call,
                fullVisualization: [(0, utils_1.getAction)('Stake'), (0, utils_1.getToken)(ST_ETH_ADDRESS, call.value)]
            };
        }
    }
    return call;
};
exports.LidoModule = LidoModule;
//# sourceMappingURL=index.js.map