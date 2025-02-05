"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSignerKey = exports.frequentlyUsedSelectors = exports.knownSelectors = exports.RECOVERY_DEFAULTS = exports.DKIM_VALIDATOR_ADDR = void 0;
const ethers_1 = require("ethers");
// TODO: change to original address once deployed
exports.DKIM_VALIDATOR_ADDR = '0x0000000000000000000000000000000000000000';
exports.RECOVERY_DEFAULTS = {
    emailTo: 'recovery@ambire.com',
    acceptUnknownSelectors: true,
    waitUntilAcceptAdded: 138240n,
    waitUntilAcceptRemoved: 138240n,
    acceptEmptyDKIMSig: true,
    acceptEmptySecondSig: true,
    onlyOneSigTimelock: 259200n // 3 days
};
exports.knownSelectors = {
    'gmail.com': '20230601'
};
exports.frequentlyUsedSelectors = [
    'Google',
    'selector1',
    'selector2',
    'everlytickey1',
    'everlytickey2',
    'eversrv',
    'k1',
    'mxvault',
    'dkim'
];
/**
 * Get the signerKey that goes as the address in privileges
 * and its accompanying priv hash for the email recovery
 *
 * @param validatorAddr string
 * @param validatorData BytesLike
 * @returns {Address, bytes32}
 */
function getSignerKey(validatorAddr, validatorData) {
    const abiCoder = new ethers_1.AbiCoder();
    const hash = (0, ethers_1.keccak256)(abiCoder.encode(['address', 'bytes'], [validatorAddr, validatorData]));
    const signerKey = (0, ethers_1.getAddress)(`0x${hash.slice(hash.length - 40, hash.length)}`);
    return { signerKey, hash };
}
exports.getSignerKey = getSignerKey;
//# sourceMappingURL=recovery.js.map