import { keccak256, toBeHex, toUtf8Bytes } from 'ethers';
import AmbireAccount from '../../contracts/compiled/AmbireAccount.json';
import AmbireAccountAbstract from '../../contracts/compiled/AmbireAccountAbstract.json';
import { EOA_SIMULATION_NONCE } from '../consts/deployless';
import { privSlot } from '../libs/proxyDeploy/deploy';
const ABSTRACT_CHAIN_ID = 2741n;
const AMBIRE_STORAGE_POSITION = keccak256(toUtf8Bytes('ambire.smart.contracts.storage'));
export function getShouldStateOverride(network, baseAcc) {
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
            [privSlot(AMBIRE_STORAGE_POSITION, 'uint256', accountAddr, 'bytes32')]: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            [toBeHex(BigInt(AMBIRE_STORAGE_POSITION) + 1n, 32)]: EOA_SIMULATION_NONCE
        };
    }
    // og Ambire smart accounts storage slots
    return {
        // if we use 0x00...01 we get a geth bug: "invalid argument 2: hex number with leading zero digits\" - on some RPC providers
        [privSlot(0, 'uint256', accountAddr, 'uint256')]: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        // any number with leading zeros is not supported on some RPCs
        [toBeHex(1, 32)]: EOA_SIMULATION_NONCE
    };
}
/**
 * Get the state override needed for accounts that are not Ambire smart accounts
 * like EOA, 7702 EOA that haven't become 7702, yet, or Safe accounts
 */
export function getNotAmbireStateOverride(accountAddr, network) {
    const code = network.chainId === ABSTRACT_CHAIN_ID
        ? AmbireAccountAbstract.binRuntime
        : AmbireAccount.binRuntime;
    return {
        [accountAddr]: {
            code,
            stateDiff: getSimulationStateDiff(accountAddr, network)
        }
    };
}
//# sourceMappingURL=simulationStateOverride.js.map