"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLETSupplyControllerMapping = void 0;
const tslib_1 = require("tslib");
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const WALLETSupplyController_json_1 = tslib_1.__importDefault(require("../../../../../contracts/compiled/WALLETSupplyController.json"));
const utils_1 = require("../../utils");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const WALLETSupplyControllerMapping = () => {
    const iface = new ethers_1.Interface(WALLETSupplyController_json_1.default);
    return {
        [iface.getFunction('claim')?.selector]: (call) => {
            const { toBurnBps } = iface.parseTransaction(call).args;
            const burnPercentage = toBurnBps.toString() / 100;
            return burnPercentage > 0
                ? [(0, utils_1.getAction)('Claim rewards'), (0, utils_1.getLabel)(`with ${burnPercentage}% burn`)]
                : [(0, utils_1.getAction)('Claim rewards')];
        },
        [iface.getFunction('claimWithRootUpdate')?.selector]: (call) => {
            const { toBurnBps } = iface.parseTransaction(call).args;
            const burnPercentage = toBurnBps.toString() / 100;
            return burnPercentage > 0
                ? [(0, utils_1.getAction)('Claim rewards'), (0, utils_1.getLabel)(`with ${burnPercentage}% burn`)]
                : [(0, utils_1.getAction)('Claim rewards')];
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        [iface.getFunction('mintVesting')?.selector]: () => {
            return [(0, utils_1.getAction)('Claim vested tokens')];
        }
    };
};
exports.WALLETSupplyControllerMapping = WALLETSupplyControllerMapping;
//# sourceMappingURL=WALLETSupplyController.js.map