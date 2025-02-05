"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyIterator = exports.getPrivateKeyFromSeed = exports.isValidPrivateKey = void 0;
/* eslint-disable new-cap */
const ethers_1 = require("ethers");
const derivation_1 = require("../../consts/derivation");
const hdPath_1 = require("../../utils/hdPath");
const account_1 = require("../account/account");
const keys_1 = require("../keys/keys");
function isValidPrivateKey(value) {
    try {
        return !!new ethers_1.Wallet(value);
    }
    catch {
        return false;
    }
}
exports.isValidPrivateKey = isValidPrivateKey;
const getPrivateKeyFromSeed = (seed, keyIndex, hdPathTemplate) => {
    const mnemonic = ethers_1.Mnemonic.fromPhrase(seed);
    const wallet = ethers_1.HDNodeWallet.fromMnemonic(mnemonic, (0, hdPath_1.getHdPathFromTemplate)(hdPathTemplate, keyIndex));
    if (wallet) {
        return wallet.privateKey;
    }
    throw new Error('Getting the private key from the seed phrase failed.');
};
exports.getPrivateKeyFromSeed = getPrivateKeyFromSeed;
/**
 * Serves for retrieving a range of addresses/keys from a given private key or seed phrase
 */
class KeyIterator {
    type = 'internal';
    subType;
    #privateKey = null;
    #seedPhrase = null;
    constructor(_privKeyOrSeed) {
        if (!_privKeyOrSeed)
            throw new Error('keyIterator: no private key or seed phrase provided');
        if (isValidPrivateKey(_privKeyOrSeed)) {
            this.#privateKey = _privKeyOrSeed;
            this.subType = 'private-key';
            return;
        }
        if (ethers_1.Mnemonic.isValidMnemonic(_privKeyOrSeed)) {
            this.#seedPhrase = _privKeyOrSeed;
            this.subType = 'seed';
            return;
        }
        throw new Error('keyIterator: invalid argument provided to constructor');
    }
    async retrieve(fromToArr, hdPathTemplate) {
        const keys = [];
        fromToArr.forEach(({ from, to }) => {
            if ((!from && from !== 0) || (!to && to !== 0) || !hdPathTemplate)
                throw new Error('keyIterator: invalid or missing arguments');
            if (this.#privateKey) {
                const shouldDerive = from >= derivation_1.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET;
                // Before v4.31.0, private keys for accounts used as smart account keys
                // were derived. That's no longer the case. Importing private keys
                // does not generate smart accounts anymore.
                if (!shouldDerive)
                    keys.push(new ethers_1.Wallet(this.#privateKey).address);
            }
            if (this.#seedPhrase) {
                const mnemonic = ethers_1.Mnemonic.fromPhrase(this.#seedPhrase);
                for (let i = from; i <= to; i++) {
                    const wallet = ethers_1.HDNodeWallet.fromMnemonic(mnemonic, (0, hdPath_1.getHdPathFromTemplate)(hdPathTemplate, i));
                    keys.push(wallet.address);
                }
            }
        });
        return keys;
    }
    retrieveInternalKeys(selectedAccountsForImport, hdPathTemplate, keystoreKeys) {
        return selectedAccountsForImport.flatMap((acc) => {
            // Should never happen
            if (!['seed', 'private-key'].includes(this.subType)) {
                console.error('keyIterator: invalid subType', this.subType);
                return [];
            }
            return acc.accountKeys.flatMap(({ index }, i) => {
                // In case it is a seed, the private keys have to be extracted
                if (this.subType === 'seed') {
                    if (!this.#seedPhrase) {
                        // Should never happen
                        console.error('keyIterator: no seed phrase provided');
                        return [];
                    }
                    const privateKey = (0, exports.getPrivateKeyFromSeed)(this.#seedPhrase, index, hdPathTemplate);
                    return [
                        {
                            addr: new ethers_1.Wallet(privateKey).address,
                            type: 'internal',
                            label: (0, keys_1.getExistingKeyLabel)(keystoreKeys, acc.account.addr, this.type) ||
                                (0, keys_1.getDefaultKeyLabel)(keystoreKeys.filter((key) => acc.account.associatedKeys.includes(key.addr)), i),
                            privateKey,
                            dedicatedToOneSA: (0, account_1.isDerivedForSmartAccountKeyOnly)(index),
                            meta: {
                                createdAt: new Date().getTime()
                            }
                        }
                    ];
                }
                // So the subType is 'private-key' then
                if (!this.#privateKey) {
                    // Should never happen
                    console.error('keyIterator: no private key provided');
                    return [];
                }
                // Before v4.31.0, private keys for accounts used as smart account keys
                // were derived. That's no longer the case. Importing private keys
                // does not generate smart accounts anymore.
                const isPrivateKeyThatShouldBeDerived = isValidPrivateKey(this.#privateKey) && index >= derivation_1.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET;
                if (isPrivateKeyThatShouldBeDerived) {
                    // Should never happen
                    console.error('keyIterator: since v4.31.0, private keys should not be derived and importing them does not retrieve a smart account');
                    return [];
                }
                return [
                    {
                        addr: new ethers_1.Wallet(this.#privateKey).address,
                        type: 'internal',
                        label: (0, keys_1.getExistingKeyLabel)(keystoreKeys, acc.account.addr, this.type) ||
                            (0, keys_1.getDefaultKeyLabel)(keystoreKeys.filter((key) => acc.account.associatedKeys.includes(key.addr)), 0),
                        privateKey: this.#privateKey,
                        dedicatedToOneSA: false,
                        meta: {
                            createdAt: new Date().getTime()
                        }
                    }
                ];
            });
        });
    }
    isSeedMatching(seedPhraseToCompareWith) {
        if (!this.#seedPhrase)
            return false;
        return (ethers_1.Mnemonic.fromPhrase(this.#seedPhrase).phrase ===
            ethers_1.Mnemonic.fromPhrase(seedPhraseToCompareWith).phrase);
    }
}
exports.KeyIterator = KeyIterator;
//# sourceMappingURL=keyIterator.js.map