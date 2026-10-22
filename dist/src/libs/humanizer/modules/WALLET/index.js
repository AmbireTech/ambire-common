"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLETModule = void 0;
const viem_1 = require("viem");
const addresses_1 = require("../../../../consts/addresses");
const utils_1 = require("../../utils");
const stakingPools_1 = require("./stakingPools");
// update return ir to be {...ir,calls:newCalls} instead of {calls:newCalls} everywhere
const WALLETSupplyController_1 = require("./WALLETSupplyController");
const stakingAddresses = [
    '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
    '0xb6456b57f03352be48bf101b46c1752a0813491a',
    '0xec3b10ce9cabab5dbf49f946a623e294963fbb4e'
];
const WALLET_SUPPLY_CONTROLLER_MAPPING = (0, WALLETSupplyController_1.WALLETSupplyControllerMapping)();
const STAKING_POOLS = (0, stakingPools_1.StakingPools)();
const wrapAllAbi = (0, viem_1.parseAbi)(['function wrapAll()']);
const stkWrapAbi = (0, viem_1.parseAbi)(['function wrap(uint256 shareAmount)']);
const stkUnwrapAbi = (0, viem_1.parseAbi)(['function unwrap(uint256 shareAmount)']);
const stkEnterAbi = (0, viem_1.parseAbi)(['function enter(uint256 amount)']);
const wrapAllSelector = (0, viem_1.toFunctionSelector)(wrapAllAbi[0]);
const stkWrapSelector = (0, viem_1.toFunctionSelector)(stkWrapAbi[0]);
const stkUnwrapSelector = (0, viem_1.toFunctionSelector)(stkUnwrapAbi[0]);
const stkEnterSelector = (0, viem_1.toFunctionSelector)(stkEnterAbi[0]);
const WALLETModule = (_, call) => {
    const matcher = {
        supplyController: WALLET_SUPPLY_CONTROLLER_MAPPING,
        stakingPool: STAKING_POOLS,
        stkWallet: {
            [wrapAllSelector]: () => {
                return [
                    (0, utils_1.getAction)('Wrap all'),
                    (0, utils_1.getToken)(addresses_1.WALLET_STAKING_ADDR, 0n),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getToken)(addresses_1.STK_WALLET, 0n)
                ];
            },
            [stkWrapSelector]: ({ data }) => {
                const { args } = (0, viem_1.decodeFunctionData)({ abi: stkWrapAbi, data });
                const [shareAmount] = args;
                return [
                    (0, utils_1.getAction)('Wrap'),
                    (0, utils_1.getToken)(addresses_1.WALLET_STAKING_ADDR, shareAmount),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getToken)(addresses_1.STK_WALLET, 0n)
                ];
            },
            [stkUnwrapSelector]: ({ data }) => {
                const { args } = (0, viem_1.decodeFunctionData)({ abi: stkUnwrapAbi, data });
                const [shareAmount] = args;
                return [
                    (0, utils_1.getAction)('Unwrap'),
                    (0, utils_1.getToken)(addresses_1.STK_WALLET, 0n),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(addresses_1.WALLET_STAKING_ADDR, shareAmount)
                ];
            },
            [stkEnterSelector]: ({ data }) => {
                const { args } = (0, viem_1.decodeFunctionData)({ abi: stkEnterAbi, data });
                const [amount] = args;
                return [
                    (0, utils_1.getAction)('Stake and wrap'),
                    (0, utils_1.getToken)(addresses_1.WALLET_TOKEN, amount),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(addresses_1.STK_WALLET, 0n)
                ];
            }
        }
    };
    if (!(0, utils_1.isHexCall)(call))
        return call;
    const selector = call.data.slice(0, 10);
    if (call.to && stakingAddresses.includes(call.to.toLowerCase()) && !call.fullVisualization) {
        if (matcher.stakingPool[selector]) {
            return {
                ...call,
                fullVisualization: matcher.stakingPool[selector](call)
            };
        }
    }
    if (matcher.supplyController[selector]) {
        return {
            ...call,
            fullVisualization: matcher.supplyController[selector](call)
        };
    }
    if (call.to &&
        call.to.toLowerCase() === addresses_1.STK_WALLET.toLowerCase() &&
        matcher.stkWallet[selector]) {
        return {
            ...call,
            fullVisualization: matcher.stkWallet[selector](call)
        };
    }
    return call;
};
exports.WALLETModule = WALLETModule;
//# sourceMappingURL=index.js.map