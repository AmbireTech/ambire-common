"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StakingPools = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
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
const StakingPools = () => {
    const iface = new ethers_1.Interface(abis_1.StakingPool);
    return {
        [iface.getFunction('enter')?.selector]: (call) => {
            const { amount } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Deposit'),
                (0, utils_1.getToken)(STAKING_POOLS[call.to.toLowerCase()].baseToken, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to)
            ];
        },
        [iface.getFunction('leave')?.selector]: (call) => {
            const { shares } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Leave'),
                (0, utils_1.getLabel)('with'),
                (0, utils_1.getToken)(STAKING_POOLS[call.to.toLowerCase()].baseToken, shares),
                (0, utils_1.getAddressVisualization)(call.to)
            ];
        },
        [iface.getFunction('withdraw')?.selector]: (call) => {
            const { shares } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Withdraw'),
                (0, utils_1.getToken)(STAKING_POOLS[call.to.toLowerCase()].baseToken, shares),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to)
            ];
        },
        [iface.getFunction('rageLeave')?.selector]: (call) => {
            const { shares } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Rage leave'),
                (0, utils_1.getLabel)('with'),
                (0, utils_1.getToken)(STAKING_POOLS[call.to.toLowerCase()].baseToken, shares),
                (0, utils_1.getAddressVisualization)(call.to)
            ];
        }
    };
};
exports.StakingPools = StakingPools;
//# sourceMappingURL=stakingPools.js.map