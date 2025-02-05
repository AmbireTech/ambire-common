"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLETModule = void 0;
const ethers_1 = require("ethers");
const addresses_1 = require("../../../../consts/addresses");
const stkWallet_1 = require("../../const/abis/stkWallet");
const utils_1 = require("../../utils");
const stakingPools_1 = require("./stakingPools");
// update return ir to be {...ir,calls:newCalls} instead of {calls:newCalls} everywhere
const WALLETSupplyController_1 = require("./WALLETSupplyController");
const stakingAddresses = [
    '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
    '0xb6456b57f03352be48bf101b46c1752a0813491a',
    '0xec3b10ce9cabab5dbf49f946a623e294963fbb4e'
];
const stkWalletIface = new ethers_1.Interface(stkWallet_1.StkWallet);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const WALLETModule = (_, irCalls) => {
    const matcher = {
        supplyController: (0, WALLETSupplyController_1.WALLETSupplyControllerMapping)(),
        stakingPool: (0, stakingPools_1.StakingPools)(),
        stkWallet: {
            [stkWalletIface.getFunction('wrapAll').selector]: () => {
                return [
                    (0, utils_1.getAction)('Wrap all'),
                    (0, utils_1.getToken)(addresses_1.WALLET_STAKING_ADDR, 0n),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getToken)(addresses_1.STK_WALLET, 0n)
                ];
            },
            [stkWalletIface.getFunction('wrap').selector]: ({ data }) => {
                const [shareAmount] = stkWalletIface.parseTransaction({ data }).args;
                return [
                    (0, utils_1.getAction)('Wrap'),
                    (0, utils_1.getToken)(addresses_1.WALLET_STAKING_ADDR, shareAmount),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getToken)(addresses_1.STK_WALLET, 0n)
                ];
            },
            [stkWalletIface.getFunction('unwrap').selector]: ({ data }) => {
                const [shareAmount] = stkWalletIface.parseTransaction({ data }).args;
                return [
                    (0, utils_1.getAction)('Unwrap'),
                    (0, utils_1.getToken)(addresses_1.STK_WALLET, 0n),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(addresses_1.WALLET_STAKING_ADDR, shareAmount)
                ];
            },
            [stkWalletIface.getFunction('stakeAndWrap').selector]: ({ data }) => {
                const [amount] = stkWalletIface.parseTransaction({ data }).args;
                return [
                    (0, utils_1.getAction)('Stake and wrap'),
                    (0, utils_1.getToken)(addresses_1.WALLET_TOKEN, amount),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(addresses_1.STK_WALLET, 0n)
                ];
            }
        }
    };
    const newCalls = irCalls.map((call) => {
        if (stakingAddresses.includes(call.to.toLowerCase()) &&
            (!call.fullVisualization || (0, utils_1.checkIfUnknownAction)(call.fullVisualization))) {
            if (matcher.stakingPool[call.data.slice(0, 10)]) {
                return {
                    ...call,
                    fullVisualization: matcher.stakingPool[call.data.slice(0, 10)](call)
                };
            }
            return {
                ...call,
                fullVisualization: (0, utils_1.getUnknownVisualization)('staking', call)
            };
        }
        if (matcher.supplyController[call.data.slice(0, 10)]) {
            return {
                ...call,
                fullVisualization: matcher.supplyController[call.data.slice(0, 10)](call)
            };
        }
        if (call.to === addresses_1.STK_WALLET && matcher.stkWallet[call.data.slice(0, 10)]) {
            return {
                ...call,
                fullVisualization: matcher.stkWallet[call.data.slice(0, 10)](call)
            };
        }
        return call;
    });
    return newCalls;
};
exports.WALLETModule = WALLETModule;
//# sourceMappingURL=index.js.map