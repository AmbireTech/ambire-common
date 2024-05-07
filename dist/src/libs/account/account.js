"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKnownAddressLabels = exports.isDerivedForSmartAccountKeyOnly = exports.isSmartAccount = exports.isAmbireV1LinkedAccount = exports.getSmartAccount = exports.getLegacyAccount = exports.getAccountDeployParams = void 0;
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const derivation_1 = require("../../consts/derivation");
const networks_1 = require("../../consts/networks");
const bytecode_1 = require("../proxyDeploy/bytecode");
const getAmbireAddressTwo_1 = require("../proxyDeploy/getAmbireAddressTwo");
// returns to, data
function getAccountDeployParams(account) {
    if (account.creation === null)
        throw new Error('tried to get deployment params for an EOA');
    const factory = new ethers_1.Interface(['function deploy(bytes calldata code, uint256 salt) external']);
    return [
        account.creation.factoryAddr,
        factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
    ];
}
exports.getAccountDeployParams = getAccountDeployParams;
function getLegacyAccount(key) {
    return {
        addr: key,
        associatedKeys: [key],
        creation: null
    };
}
exports.getLegacyAccount = getLegacyAccount;
async function getSmartAccount(address) {
    // Temporarily use the polygon network,
    // to be discussed which network we would use for
    // getBytocode once the contract is deployed on all of them
    const polygon = networks_1.networks.find((x) => x.id === 'polygon');
    if (!polygon)
        throw new Error('unable to find polygon network in consts');
    const priv = {
        addr: address,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    };
    const bytecode = await (0, bytecode_1.getBytecode)(polygon, [priv]);
    return {
        addr: (0, getAmbireAddressTwo_1.getAmbireAccountAddress)(deploy_1.AMBIRE_ACCOUNT_FACTORY, bytecode),
        associatedKeys: [address],
        creation: {
            factoryAddr: deploy_1.AMBIRE_ACCOUNT_FACTORY,
            bytecode,
            salt: ethers_1.ethers.toBeHex(0, 32)
        }
    };
}
exports.getSmartAccount = getSmartAccount;
const isAmbireV1LinkedAccount = (factoryAddr) => factoryAddr === '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA';
exports.isAmbireV1LinkedAccount = isAmbireV1LinkedAccount;
const isSmartAccount = (account) => !!account.creation;
exports.isSmartAccount = isSmartAccount;
/**
 * Checks if a (legacy) EOA account is a derived one,
 * that is meant to be used as a smart account key only.
 */
const isDerivedForSmartAccountKeyOnly = (index) => index >= derivation_1.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET;
exports.isDerivedForSmartAccountKeyOnly = isDerivedForSmartAccountKeyOnly;
/**
 * Map account addresses to their respective labels (if they have ones) in order
 * to display user-friendly labels instead of raw addresses. The addresses
 * for which there is a label are considered "known addresses".
 */
const getKnownAddressLabels = (accounts, accountPreferences, keys, keyPreferences) => {
    const knownAddressLabels = {};
    // Check if the address is in the key preferences (lowest priority)
    keys.forEach((key) => {
        // Note: not using .findLast, because it's not compatible with TypeScript, blah
        const filteredKeyPreferences = keyPreferences.filter((x) => x.addr === key.addr && !!x.label);
        // There could be more than one, since there could be more than one key
        // with the same address. In that case, the last (probably newest) one wins.
        const currentKeyPreferences = filteredKeyPreferences[filteredKeyPreferences.length - 1];
        if (currentKeyPreferences) {
            knownAddressLabels[key.addr] = currentKeyPreferences.label;
        }
    });
    // TODO: Check if the address is in the address book (second lowest)
    // Check if address is in the account preferences (highest priority)
    accounts.forEach((acc) => {
        const accPref = accountPreferences[acc.addr];
        if (accPref?.label) {
            knownAddressLabels[acc.addr] = accPref.label;
        }
    });
    return knownAddressLabels;
};
exports.getKnownAddressLabels = getKnownAddressLabels;
//# sourceMappingURL=account.js.map