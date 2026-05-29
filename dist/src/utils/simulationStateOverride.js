"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShouldStateOverride = getShouldStateOverride;
exports.getNotAmbireStateOverride = getNotAmbireStateOverride;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../contracts/compiled/AmbireAccount.json"));
const AmbireAccountAbstract_json_1 = tslib_1.__importDefault(require("../../contracts/compiled/AmbireAccountAbstract.json"));
const deployless_1 = require("../consts/deployless");
const deploy_1 = require("../libs/proxyDeploy/deploy");
const ABSTRACT_CHAIN_ID = 2741n;
const AMBIRE_STORAGE_POSITION = (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)('ambire.smart.contracts.storage'));
function getShouldStateOverride(network, baseAcc) {
    // always state override the abstract chain
    if (network.chainId === ABSTRACT_CHAIN_ID)
        return true;
    return !network.rpcNoStateOverride && baseAcc.shouldStateOverrideDuringSimulations();
}
/**
 * The abstract chain simulation contract uses the new storage slots placed at:
 * ambire.smart.contracts.storage
 */
function getSimulationStateDiff(accountAddr, network) {
    if (network.chainId === ABSTRACT_CHAIN_ID) {
        return {
            [(0, deploy_1.privSlot)(AMBIRE_STORAGE_POSITION, 'uint256', accountAddr, 'bytes32')]: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            [(0, ethers_1.toBeHex)(BigInt(AMBIRE_STORAGE_POSITION) + 1n, 32)]: deployless_1.EOA_SIMULATION_NONCE
        };
    }
    // og Ambire smart accounts storage slots
    return {
        // if we use 0x00...01 we get a geth bug: "invalid argument 2: hex number with leading zero digits\" - on some RPC providers
        [(0, deploy_1.privSlot)(0, 'uint256', accountAddr, 'uint256')]: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        // any number with leading zeros is not supported on some RPCs
        [(0, ethers_1.toBeHex)(1, 32)]: deployless_1.EOA_SIMULATION_NONCE
    };
}
/**
 * Get the state override needed for accounts that are not Ambire smart accounts
 * like EOA, 7702 EOA that haven't become 7702, yet, or Safe accounts
 */
function getNotAmbireStateOverride(accountAddr, network) {
    const code = network.chainId === ABSTRACT_CHAIN_ID
        ? AmbireAccountAbstract_json_1.default.binRuntime
        : AmbireAccount_json_1.default.binRuntime;
    return {
        [accountAddr]: {
            code,
            stateDiff: getSimulationStateDiff(accountAddr, network)
        }
    };
}
//# sourceMappingURL=simulationStateOverride.js.map