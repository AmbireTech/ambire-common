"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLETSupplyControllerMapping = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const claimAbi = (0, viem_1.parseAbi)([
    'function claim(uint256 totalRewardInTree, bytes32[] proof, uint256 toBurnBps, address stakingPool)'
]);
const claimWithRootUpdateAbi = (0, viem_1.parseAbi)([
    'function claimWithRootUpdate(uint256 totalRewardInTree, bytes32[] proof, uint256 toBurnBps, address stakingPool, bytes32 newRoot, bytes signature)'
]);
const mintVestingAbi = (0, viem_1.parseAbi)([
    'function mintVesting(address recipient, uint256 end, uint256 amountPerSecond)'
]);
const claimSelector = (0, viem_1.toFunctionSelector)(claimAbi[0]);
const claimWithRootUpdateSelector = (0, viem_1.toFunctionSelector)(claimWithRootUpdateAbi[0]);
const mintVestingSelector = (0, viem_1.toFunctionSelector)(mintVestingAbi[0]);
const WALLETSupplyControllerMapping = () => {
    return {
        [claimSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: claimAbi, data: call.data });
            const [, , toBurnBps, stakingPool] = args;
            const burnPercentage = Number(toBurnBps) / 100;
            return burnPercentage > 0
                ? [
                    (0, utils_1.getAction)('Claim rewards'),
                    (0, utils_1.getLabel)(`with ${burnPercentage}% burn`),
                    (0, utils_1.getLabel)('in'),
                    (0, utils_1.getToken)(stakingPool, 0n)
                ]
                : [(0, utils_1.getAction)('Claim rewards'), (0, utils_1.getLabel)('in'), (0, utils_1.getToken)(stakingPool, 0n)];
        },
        [claimWithRootUpdateSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: claimWithRootUpdateAbi, data: call.data });
            const [, , toBurnBps, stakingPool] = args;
            const burnPercentage = Number(toBurnBps) / 100;
            return burnPercentage > 0
                ? [
                    (0, utils_1.getAction)('Claim rewards'),
                    (0, utils_1.getLabel)(`with ${burnPercentage}% burn`),
                    (0, utils_1.getLabel)('in'),
                    (0, utils_1.getToken)(stakingPool, 0n)
                ]
                : [(0, utils_1.getAction)('Claim rewards'), (0, utils_1.getLabel)('in'), (0, utils_1.getToken)(stakingPool, 0n)];
        },
        [mintVestingSelector]: () => {
            return [(0, utils_1.getAction)('Claim vested tokens')];
        }
    };
};
exports.WALLETSupplyControllerMapping = WALLETSupplyControllerMapping;
//# sourceMappingURL=WALLETSupplyController.js.map