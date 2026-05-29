"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLETSupplyControllerMapping = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const WALLETSupplyController_json_1 = tslib_1.__importDefault(require("../../../../../contracts/compiled/WALLETSupplyController.json"));
const utils_1 = require("../../utils");
const WALLETSupplyControllerMapping = () => {
    const iface = new ethers_1.Interface(WALLETSupplyController_json_1.default);
    return {
        [iface.getFunction('claim')?.selector]: (call) => {
            const { toBurnBps, stakingPool } = iface.parseTransaction(call).args;
            const burnPercentage = toBurnBps.toString() / 100;
            return burnPercentage > 0
                ? [
                    (0, utils_1.getAction)('Claim rewards'),
                    (0, utils_1.getLabel)(`with ${burnPercentage}% burn`),
                    (0, utils_1.getLabel)('in'),
                    (0, utils_1.getToken)(stakingPool, 0n)
                ]
                : [(0, utils_1.getAction)('Claim rewards'), (0, utils_1.getLabel)('in'), (0, utils_1.getToken)(stakingPool, 0n)];
        },
        [iface.getFunction('claimWithRootUpdate')?.selector]: (call) => {
            const { toBurnBps, stakingPool } = iface.parseTransaction(call).args;
            const burnPercentage = toBurnBps.toString() / 100;
            return burnPercentage > 0
                ? [
                    (0, utils_1.getAction)('Claim rewards'),
                    (0, utils_1.getLabel)(`with ${burnPercentage}% burn`),
                    (0, utils_1.getLabel)('in'),
                    (0, utils_1.getToken)(stakingPool, 0n)
                ]
                : [(0, utils_1.getAction)('Claim rewards'), (0, utils_1.getLabel)('in'), (0, utils_1.getToken)(stakingPool, 0n)];
        },
        [iface.getFunction('mintVesting')?.selector]: () => {
            return [(0, utils_1.getAction)('Claim vested tokens')];
        }
    };
};
exports.WALLETSupplyControllerMapping = WALLETSupplyControllerMapping;
//# sourceMappingURL=WALLETSupplyController.js.map