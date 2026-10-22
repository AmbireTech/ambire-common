"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StakingPools = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const STAKING_POOLS = {
    '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935': {
        baseToken: '0x88800092ff476844f74dc2fc427974bbee2794ae',
        name: 'WALLET Staking Pool'
    },
    '0xb6456b57f03352be48bf101b46c1752a0813491a': {
        baseToken: '0xade00c28244d5ce17d72e40330b1c318cd12b7c3',
        name: 'ADX Staking Pool'
    },
    // this is on polygon for tests
    '0xec3b10ce9cabab5dbf49f946a623e294963fbb4e': {
        baseToken: '0xe9415e904143e42007865e6864f7f632bd054a08',
        name: 'WALLET Staking Pool (Test)'
    }
};
// const WALLET_TOKEN_ADDR = '0x88800092ff476844f74dc2fc427974bbee2794ae'
const enterAbi = (0, viem_1.parseAbi)(['function enter(uint256 amount)']);
const leaveAbi = (0, viem_1.parseAbi)(['function leave(uint256 shares, bool skipMint)']);
const withdrawAbi = (0, viem_1.parseAbi)([
    'function withdraw(uint256 shares, uint256 unlocksAt, bool skipMint)'
]);
const rageLeaveAbi = (0, viem_1.parseAbi)(['function rageLeave(uint256 shares, bool skipMint)']);
const enterSelector = (0, viem_1.toFunctionSelector)(enterAbi[0]);
const leaveSelector = (0, viem_1.toFunctionSelector)(leaveAbi[0]);
const withdrawSelector = (0, viem_1.toFunctionSelector)(withdrawAbi[0]);
const rageLeaveSelector = (0, viem_1.toFunctionSelector)(rageLeaveAbi[0]);
const StakingPools = () => {
    return {
        [enterSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in staking humanizer when !call.to');
            const baseToken = STAKING_POOLS[call.to.toLowerCase()]?.baseToken;
            if (!baseToken)
                throw Error('Humanizer: unknown staking pool');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: enterAbi, data: call.data });
            const [amount] = args;
            return [
                (0, utils_1.getAction)('Deposit'),
                (0, utils_1.getToken)(baseToken, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to)
            ];
        },
        [leaveSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in staking humanizer when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: leaveAbi, data: call.data });
            const [shares] = args;
            return [(0, utils_1.getAction)('Leave'), (0, utils_1.getLabel)('with'), (0, utils_1.getToken)(call.to, shares)];
        },
        [withdrawSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in staking humanizer when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: withdrawAbi, data: call.data });
            const [shares] = args;
            return [(0, utils_1.getAction)('Withdraw'), (0, utils_1.getToken)(call.to, shares)];
        },
        [rageLeaveSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in staking humanizer when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: rageLeaveAbi, data: call.data });
            const [shares] = args;
            return [(0, utils_1.getAction)('Rage leave'), (0, utils_1.getLabel)('with'), (0, utils_1.getToken)(call.to, shares)];
        }
    };
};
exports.StakingPools = StakingPools;
//# sourceMappingURL=stakingPools.js.map