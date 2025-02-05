"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEoaSimulationStateOverride = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../contracts/compiled/AmbireAccount.json"));
const deployless_1 = require("../consts/deployless");
const deploy_1 = require("../libs/proxyDeploy/deploy");
/**
 *
 * @param accountAddr account address
 * @returns the state override object required for transaction simulation and estimation
 */
function getEoaSimulationStateOverride(accountAddr) {
    return {
        [accountAddr]: {
            code: AmbireAccount_json_1.default.binRuntime,
            stateDiff: {
                // if we use 0x00...01 we get a geth bug: "invalid argument 2: hex number with leading zero digits\" - on some RPC providers
                [`0x${(0, deploy_1.privSlot)(0, 'address', accountAddr, 'bytes32')}`]: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                // any number with leading zeros is not supported on some RPCs
                [(0, ethers_1.toBeHex)(1, 32)]: deployless_1.EOA_SIMULATION_NONCE
            }
        }
    };
}
exports.getEoaSimulationStateOverride = getEoaSimulationStateOverride;
//# sourceMappingURL=simulationStateOverride.js.map