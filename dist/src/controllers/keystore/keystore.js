"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeystoreController = void 0;
const tslib_1 = require("tslib");
/* eslint-disable class-methods-use-this */
/* eslint-disable new-cap */
/* eslint-disable @typescript-eslint/no-shadow */
const aes_js_1 = tslib_1.__importDefault(require("aes-js"));
const eth_crypto_1 = require("eth-crypto");
const ethers_1 = require("ethers");
// import { entropyToMnemonic } from 'bip39'
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const derivation_1 = require("../../consts/derivation");
const entropyGenerator_1 = require("../../libs/entropyGenerator/entropyGenerator");
const keys_1 = require("../../libs/keys/keys");
const scryptAdapter_1 = require("../../libs/scrypt/scryptAdapter");
const shortenAddress_1 = tslib_1.__importDefault(require("../../utils/shortenAddress"));
const uuid_1 = require("../../utils/uuid");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const scryptDefaults = { N: 131072, r: 8, p: 1, dkLen: 64 };
const CIPHER = 'aes-128-ctr';
const KEYSTORE_UNEXPECTED_ERROR_MESSAGE = 'Keystore unexpected error. If the problem persists, please contact support.';
const STATUS_WRAPPED_METHODS = {
    unlockWithSecret: 'INITIAL',
    addSecret: 'INITIAL',
    addSeed: 'INITIAL',
    updateSeed: 'INITIAL',
    deleteSeed: 'INITIAL',
    removeSecret: 'INITIAL',
    addKeys: 'INITIAL',
    addKeysExternallyStored: 'INITIAL',
    changeKeystorePassword: 'INITIAL',
    updateKeyPreferences: 'INITIAL'
};
function getBytesForSecret(secret) {
    // see https://github.com/ethers-io/ethers.js/blob/v5/packages/json-wallets/src.ts/utils.ts#L19-L24
    return (0, ethers_1.toUtf8Bytes)(secret, 'NFKC');
}
/**
 * The KeystoreController is a class that manages a collection of encrypted keys.
 * It provides methods for adding, removing, and retrieving keys. The keys are
 * encrypted using a main key, which is itself encrypted using one or more secrets.
 *
 * Docs:
 *   - Secrets are strings that are used to encrypt the mainKey; the mainKey
 *     could be encrypted with many secrets
 *   - All individual keys are encrypted with the mainKey
 *   - The mainKey is kept in memory, but only for the unlockedTime
 * Design decisions:
 *   - decided to store all keys in the Keystore, even if the private key itself
 *     is not stored there; simply because it's called a Keystore and the name
 *     implies the functionality
 *   - handle HW wallets in it, so that we handle everything uniformly with a
 *     single API; also, it allows future flexibility to have the concept of
 *     optional unlocking built-in; if we have interactivity, we can add
 *     `keystore.signExtraInputRequired(key)` which returns what we need from the user
 *   - `signWithkey` is presumed to be non-interactive at least from `Keystore`
 *     point of view (requiring no extra user inputs). This could be wrong, if
 *     hardware wallets require extra input - they normally always do, but with
 *     the web SDKs we "outsource" this to the HW wallet software itself;
 *     this may not be true on mobile
 */
class KeystoreController extends eventEmitter_1.default {
    #mainKey;
    // Secrets are strings that are used to encrypt the mainKey.
    // The mainKey could be encrypted with many secrets.
    #keystoreSecrets = [];
    #storage;
    #keystoreSeeds = [];
    #tempSeed = null;
    #keystoreSigners;
    #keystoreKeys = [];
    #internalKeysToAddOnKeystoreReady = [];
    #externalKeysToAddOnKeystoreReady = [];
    keyStoreUid;
    #isReadyToStoreKeys = false;
    errorMessage = '';
    statuses = STATUS_WRAPPED_METHODS;
    // Holds the initial load promise, so that one can wait until it completes
    #initialLoadPromise;
    #windowManager;
    #scryptAdapter;
    constructor(platform, _storage, _keystoreSigners, windowManager) {
        super();
        this.#storage = _storage;
        this.#keystoreSigners = _keystoreSigners;
        this.#mainKey = null;
        this.keyStoreUid = null;
        this.#windowManager = windowManager;
        this.#scryptAdapter = new scryptAdapter_1.ScryptAdapter(platform);
        this.#initialLoadPromise = this.#load();
    }
    async #load() {
        try {
            const [keystoreSeeds, keyStoreUid, keystoreKeys] = await Promise.all([
                this.#storage.get('keystoreSeeds', []),
                this.#storage.get('keyStoreUid', null),
                this.#storage.get('keystoreKeys', [])
            ]);
            this.keyStoreUid = keyStoreUid;
            this.#keystoreSeeds = keystoreSeeds.map((s) => {
                if (s.id)
                    return s;
                // Migrate the old seed structure to the new one for cases where the prev versions
                // of the extension supported only one saved seed which lacked id and label props.
                return { ...s, id: 'legacy-saved-seed', label: 'Recovery Phrase 1' };
            });
            this.#keystoreKeys = keystoreKeys;
        }
        catch (e) {
            this.emitError({
                message: 'Something went wrong when loading the Keystore. Please try again or contact support if the problem persists.',
                level: 'major',
                error: new Error('keystore: failed to pull keys from storage')
            });
        }
        try {
            this.#keystoreSecrets = await this.#storage.get('keystoreSecrets', []);
            this.isReadyToStoreKeys = this.#keystoreSecrets.length > 0;
        }
        catch (e) {
            this.emitError({
                message: 'Something went wrong when initiating the Keystore. Please try again or contact support if the problem persists.',
                level: 'major',
                error: new Error('keystore: failed to getMainKeyEncryptedWithSecrets() from storage')
            });
        }
        this.emitUpdate();
    }
    lock() {
        this.#mainKey = null;
        if (this.#tempSeed)
            this.deleteTempSeed(false);
        this.emitUpdate();
    }
    get isUnlocked() {
        return !!this.#mainKey;
    }
    get hasTempSeed() {
        return !!this.#tempSeed;
    }
    get isReadyToStoreKeys() {
        return this.#isReadyToStoreKeys;
    }
    set isReadyToStoreKeys(val) {
        this.#isReadyToStoreKeys = val;
        if (val && this.#internalKeysToAddOnKeystoreReady.length) {
            this.#addKeys(this.#internalKeysToAddOnKeystoreReady);
        }
        if (val && this.#externalKeysToAddOnKeystoreReady.length) {
            this.#addKeysExternallyStored(this.#externalKeysToAddOnKeystoreReady);
        }
    }
    async getKeyStoreUid() {
        const uid = this.keyStoreUid;
        if (!uid)
            throw new Error('keystore: adding secret before get uid');
        return uid;
    }
    // @TODO time before unlocking
    async #unlockWithSecret(secretId, secret) {
        await this.#initialLoadPromise;
        // @TODO should we check if already locked? probably not cause this function can  be used in order to verify if a secret is correct
        if (!this.#keystoreSecrets.length) {
            throw new EmittableError_1.default({
                message: 'Trying to unlock Ambire, but the lock mechanism was not fully configured yet. Please try again or contact support if the problem persists.',
                level: 'major',
                error: new Error('keystore: no secrets yet')
            });
        }
        const secretEntry = this.#keystoreSecrets.find((x) => x.id === secretId);
        if (!secretEntry) {
            throw new EmittableError_1.default({
                message: 'Something went wrong when trying to unlock Ambire. Please try again or contact support if the problem persists.',
                level: 'major',
                error: new Error('keystore: secret not found')
            });
        }
        const { scryptParams, aesEncrypted } = secretEntry;
        if (aesEncrypted.cipherType !== CIPHER) {
            throw new EmittableError_1.default({
                message: 'Something went wrong when trying to unlock Ambire. Please try again or contact support if the problem persists.',
                level: 'major',
                error: new Error(`keystore: unsupported cipherType ${aesEncrypted.cipherType}`)
            });
        }
        await (0, wait_1.default)(0); // a trick to prevent UI freeze while the CPU is busy
        const key = await this.#scryptAdapter.scrypt(getBytesForSecret(secret), (0, ethers_1.getBytes)(scryptParams.salt), {
            N: scryptParams.N,
            r: scryptParams.r,
            p: scryptParams.p,
            dkLen: scryptParams.dkLen
        });
        await (0, wait_1.default)(0);
        const iv = (0, ethers_1.getBytes)(aesEncrypted.iv);
        const derivedKey = key.slice(0, 16);
        const macPrefix = key.slice(16, 32);
        const counter = new aes_js_1.default.Counter(iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(derivedKey, counter);
        const mac = (0, ethers_1.keccak256)((0, ethers_1.concat)([macPrefix, aesEncrypted.ciphertext]));
        if (mac !== aesEncrypted.mac) {
            this.errorMessage = 'Incorrect password. Please try again.';
            this.emitUpdate();
            const error = new Error(this.errorMessage);
            throw new EmittableError_1.default({ level: 'silent', message: this.errorMessage, error });
        }
        this.errorMessage = '';
        const decrypted = aesCtr.decrypt((0, ethers_1.getBytes)(aesEncrypted.ciphertext));
        this.#mainKey = { key: decrypted.slice(0, 16), iv: decrypted.slice(16, 32) };
    }
    async unlockWithSecret(secretId, secret) {
        await this.withStatus('unlockWithSecret', () => this.#unlockWithSecret(secretId, secret), true);
    }
    async #addSecret(secretId, secret, extraEntropy = '', leaveUnlocked = false) {
        await this.#initialLoadPromise;
        // @TODO test
        if (this.#keystoreSecrets.find((x) => x.id === secretId))
            throw new EmittableError_1.default({
                message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
                level: 'major',
                error: new Error(`keystore: trying to add duplicate secret ${secretId}`)
            });
        let mainKey = this.#mainKey;
        const entropyGenerator = new entropyGenerator_1.EntropyGenerator();
        // We are not unlocked
        if (!mainKey) {
            if (!this.#keystoreSecrets.length) {
                mainKey = {
                    key: entropyGenerator.generateRandomBytes(16, extraEntropy),
                    iv: entropyGenerator.generateRandomBytes(16, extraEntropy)
                };
            }
            else
                throw new EmittableError_1.default({
                    message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
                    level: 'major',
                    error: new Error('keystore: must unlock keystore before adding secret')
                });
            if (leaveUnlocked) {
                this.#mainKey = mainKey;
            }
        }
        const salt = entropyGenerator.generateRandomBytes(32, extraEntropy);
        await (0, wait_1.default)(0); // a trick to prevent UI freeze while the CPU is busy
        const key = await this.#scryptAdapter.scrypt(getBytesForSecret(secret), salt, {
            N: scryptDefaults.N,
            r: scryptDefaults.r,
            p: scryptDefaults.p,
            dkLen: scryptDefaults.dkLen
        });
        await (0, wait_1.default)(0);
        const iv = entropyGenerator.generateRandomBytes(16, extraEntropy);
        const derivedKey = key.slice(0, 16);
        const macPrefix = key.slice(16, 32);
        const counter = new aes_js_1.default.Counter(iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(derivedKey, counter);
        const ciphertext = aesCtr.encrypt((0, ethers_1.getBytes)((0, ethers_1.concat)([mainKey.key, mainKey.iv])));
        const mac = (0, ethers_1.keccak256)((0, ethers_1.concat)([macPrefix, ciphertext]));
        this.#keystoreSecrets.push({
            id: secretId,
            scryptParams: { salt: (0, ethers_1.hexlify)(salt), ...scryptDefaults },
            aesEncrypted: {
                cipherType: CIPHER,
                ciphertext: (0, ethers_1.hexlify)(ciphertext),
                iv: (0, ethers_1.hexlify)(iv),
                mac: (0, ethers_1.hexlify)(mac)
            }
        });
        // Persist the new secrets
        await this.#storage.set('keystoreSecrets', this.#keystoreSecrets);
        // produce uid if one doesn't exist (should be created when the first secret is added)
        if (!this.keyStoreUid) {
            const uid = (0, eth_crypto_1.publicKeyByPrivateKey)((0, ethers_1.hexlify)((0, ethers_1.getBytes)((0, ethers_1.concat)([mainKey.key, mainKey.iv]))));
            this.keyStoreUid = uid;
            await this.#storage.set('keyStoreUid', uid);
        }
        this.isReadyToStoreKeys = true;
    }
    async addSecret(secretId, secret, extraEntropy, leaveUnlocked) {
        await this.withStatus('addSecret', () => this.#addSecret(secretId, secret, extraEntropy, leaveUnlocked), true);
    }
    async #removeSecret(secretId) {
        await this.#initialLoadPromise;
        if (!this.#keystoreSecrets.find((x) => x.id === secretId))
            throw new EmittableError_1.default({
                message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
                level: 'major',
                error: new Error(`keystore: secret$ ${secretId} not found`)
            });
        this.#keystoreSecrets = this.#keystoreSecrets.filter((x) => x.id !== secretId);
        await this.#storage.set('keystoreSecrets', this.#keystoreSecrets);
    }
    async removeSecret(secretId) {
        await this.withStatus('removeSecret', () => this.#removeSecret(secretId));
    }
    get keys() {
        return this.#keystoreKeys.map(({ addr, type, label, dedicatedToOneSA, meta }) => {
            // Written with this 'internal' type guard (if) on purpose, because this
            // way TypeScript will be able to narrow down the types properly and infer
            // the return type of the map function correctly.
            if (type === 'internal') {
                return {
                    addr,
                    type,
                    label,
                    dedicatedToOneSA,
                    meta,
                    isExternallyStored: false
                };
            }
            return {
                addr,
                type,
                label,
                dedicatedToOneSA,
                meta: meta,
                isExternallyStored: true
            };
        });
    }
    get seeds() {
        return this.#keystoreSeeds.map(({ id, label, hdPathTemplate, seedPassphrase }) => ({
            id,
            label: label || 'Unnamed Recovery Seed',
            hdPathTemplate,
            withPassphrase: !!seedPassphrase
        }));
    }
    async #getEncryptedSeedPhrase(seed, seedPassphrase) {
        await this.#initialLoadPromise;
        if (this.#mainKey === null)
            throw new EmittableError_1.default({
                message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
                level: 'major',
                error: new Error('keystore: needs to be unlocked')
            });
        if (!ethers_1.Mnemonic.isValidMnemonic(seed)) {
            throw new EmittableError_1.default({
                message: 'You are trying to store an invalid seed phrase.',
                level: 'major',
                error: new Error('keystore: trying to add an invalid seed phrase')
            });
        }
        // Set up the cipher
        const counter = new aes_js_1.default.Counter(this.#mainKey.iv); // TS compiler fails to detect we check for null above
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(this.#mainKey.key, counter); // TS compiler fails to detect we check for null above\
        return {
            seed: (0, ethers_1.hexlify)(aesCtr.encrypt(new TextEncoder().encode(seed))),
            passphrase: seedPassphrase
                ? (0, ethers_1.hexlify)(aesCtr.encrypt(new TextEncoder().encode(seedPassphrase)))
                : null
        };
    }
    async addTempSeed({ seed, seedPassphrase, hdPathTemplate }) {
        const validHdPath = derivation_1.DERIVATION_OPTIONS.some((o) => o.value === hdPathTemplate);
        if (!validHdPath)
            throw new EmittableError_1.default({
                message: 'Incorrect derivation path when trying to update the temp seed. Please contact support',
                level: 'major',
                error: new Error('keystore: hd path to temp seed incorrect')
            });
        this.#tempSeed = { seed, seedPassphrase, hdPathTemplate };
        this.emitUpdate();
    }
    deleteTempSeed(shouldUpdate = true) {
        this.#tempSeed = null;
        if (shouldUpdate)
            this.emitUpdate();
    }
    async persistTempSeed() {
        if (!this.#tempSeed)
            return;
        await this.#addSeed(this.#tempSeed);
        this.#tempSeed = null;
        this.emitUpdate();
    }
    async #addSeed({ seed, seedPassphrase, hdPathTemplate }) {
        const { seed: seedPhrase, passphrase } = await this.#getEncryptedSeedPhrase(seed, seedPassphrase);
        const existingEntry = this.#keystoreSeeds.find((entry) => entry.seed === seedPhrase && entry.seedPassphrase === seedPassphrase);
        if (existingEntry)
            return;
        const label = `Recovery Phrase ${this.#keystoreSeeds.length + 1}`;
        const newEntry = {
            id: (0, uuid_1.generateUuid)(),
            label,
            seed: seedPhrase,
            seedPassphrase: passphrase,
            hdPathTemplate
        };
        this.#keystoreSeeds.push(newEntry);
        await this.#storage.set('keystoreSeeds', this.#keystoreSeeds);
        this.emitUpdate();
    }
    async addSeed(keystoreSeed) {
        await this.withStatus('addSeed', () => this.#addSeed(keystoreSeed), true);
    }
    async #updateSeed({ id, label, hdPathTemplate }) {
        if (!label && !hdPathTemplate)
            return;
        const keystoreSeed = this.#keystoreSeeds.find((s) => s.id === id);
        if (!keystoreSeed)
            return;
        if (label)
            keystoreSeed.label = label;
        if (hdPathTemplate)
            keystoreSeed.hdPathTemplate = hdPathTemplate;
        const updatedKeystoreSeeds = this.#keystoreSeeds.map((s) => s.id === keystoreSeed.id ? keystoreSeed : s);
        this.#keystoreSeeds = updatedKeystoreSeeds;
        await this.#storage.set('keystoreSeeds', this.#keystoreSeeds);
        this.emitUpdate();
    }
    async updateSeed({ id, label, hdPathTemplate }) {
        await this.withStatus('updateSeed', () => this.#updateSeed({ id, label, hdPathTemplate }), true);
    }
    async deleteSeed(id) {
        await this.withStatus('deleteSeed', () => this.#deleteSeed(id));
    }
    async #deleteSeed(id) {
        await this.#initialLoadPromise;
        this.#keystoreSeeds = this.#keystoreSeeds.filter((s) => s.id !== id);
        await this.#storage.set('keystoreSeeds', this.#keystoreSeeds);
        this.emitUpdate();
    }
    async changeTempSeedHdPathTemplateIfNeeded(nextHdPathTemplate) {
        if (!nextHdPathTemplate)
            return; // should never happen
        await this.#initialLoadPromise;
        if (!this.isUnlocked)
            throw new Error('keystore: not unlocked');
        if (!this.#tempSeed)
            throw new Error('keystore: no temp seed at the moment');
        const isTheSameHdPathTemplate = this.#tempSeed.hdPathTemplate === nextHdPathTemplate;
        if (isTheSameHdPathTemplate)
            return;
        this.#tempSeed.hdPathTemplate = nextHdPathTemplate;
        this.emitUpdate();
    }
    async #addKeysExternallyStored(keysToAdd) {
        await this.#initialLoadPromise;
        if (!keysToAdd.length)
            return;
        if (!this.isReadyToStoreKeys) {
            this.#externalKeysToAddOnKeystoreReady = [
                ...this.#externalKeysToAddOnKeystoreReady,
                ...keysToAdd
            ];
            return;
        }
        // Strip out keys with duplicated private keys. One unique key is enough.
        const uniqueKeys = [];
        const uniqueKeysToAdd = keysToAdd.filter(({ addr, type }) => {
            if (uniqueKeys.some((x) => x.addr === addr && x.type === type)) {
                return false;
            }
            uniqueKeys.push({ addr, type });
            return true;
        });
        if (!uniqueKeysToAdd.length)
            return;
        const keys = this.#keystoreKeys;
        const newKeys = uniqueKeysToAdd
            .map(({ addr, type, label, dedicatedToOneSA, meta }) => ({
            addr,
            type,
            label,
            dedicatedToOneSA,
            meta,
            privKey: null
        }))
            // No need to re-add keys that are already added (with the same type / device)
            .filter(({ addr, type }) => !keys.some((x) => x.addr === addr && x.type === type));
        if (!newKeys.length)
            return;
        const nextKeys = [...keys, ...newKeys];
        this.#keystoreKeys = nextKeys;
        await this.#storage.set('keystoreKeys', nextKeys);
    }
    async addKeysExternallyStored(keysToAdd) {
        await this.withStatus('addKeysExternallyStored', () => this.#addKeysExternallyStored(keysToAdd), true);
    }
    async #addKeys(keysToAdd) {
        await this.#initialLoadPromise;
        if (!keysToAdd.length)
            return;
        if (!this.isReadyToStoreKeys) {
            this.#internalKeysToAddOnKeystoreReady = [
                ...this.#internalKeysToAddOnKeystoreReady,
                ...keysToAdd
            ];
            return;
        }
        if (this.#mainKey === null)
            throw new EmittableError_1.default({
                message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
                level: 'major',
                error: new Error('keystore: needs to be unlocked')
            });
        // Strip out keys with duplicated private keys. One unique key is enough.
        const uniquePrivateKeysToAddSet = new Set();
        const uniqueKeysToAdd = keysToAdd.filter(({ privateKey }) => {
            if (!uniquePrivateKeysToAddSet.has(privateKey)) {
                uniquePrivateKeysToAddSet.add(privateKey);
                return true;
            }
            return false;
        });
        if (!uniqueKeysToAdd.length)
            return;
        const keys = this.#keystoreKeys;
        const newKeys = uniqueKeysToAdd
            .map(({ addr, type, label, privateKey, dedicatedToOneSA, meta }) => {
            // eslint-disable-next-line no-param-reassign
            privateKey = privateKey.substring(0, 2) === '0x' ? privateKey.substring(2) : privateKey;
            // Set up the cipher
            const counter = new aes_js_1.default.Counter(this.#mainKey.iv); // TS compiler fails to detect we check for null above
            const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(this.#mainKey.key, counter); // TS compiler fails to detect we check for null above
            return {
                addr,
                type,
                label,
                dedicatedToOneSA,
                privKey: (0, ethers_1.hexlify)(aesCtr.encrypt(aes_js_1.default.utils.hex.toBytes(privateKey))), // TODO: consider a MAC?
                meta
            };
        })
            // No need to re-add keys that are already added, private key never changes
            .filter(({ addr, type }) => !keys.some((x) => x.addr === addr && x.type === type));
        if (!newKeys.length)
            return;
        const nextKeys = [...keys, ...newKeys];
        this.#keystoreKeys = nextKeys;
        await this.#storage.set('keystoreKeys', nextKeys);
    }
    async addKeys(keysToAdd) {
        await this.withStatus('addKeys', () => this.#addKeys(keysToAdd), true);
    }
    async removeKey(addr, type) {
        await this.#initialLoadPromise;
        if (!this.isUnlocked)
            throw new EmittableError_1.default({
                message: 'Extension not unlocked. Please try again or contact support if the problem persists.',
                level: 'major',
                error: new Error('keystore: not unlocked')
            });
        const keys = this.#keystoreKeys;
        if (!keys.find((x) => x.addr === addr && x.type === type))
            throw new EmittableError_1.default({
                message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
                level: 'major',
                error: new Error(`keystore: trying to remove key that does not exist: address: ${addr}, type: ${type}`)
            });
        this.#keystoreKeys = keys.filter((key) => {
            const isMatching = key.addr === addr && key.type === type;
            return !isMatching;
        });
        await this.#storage.set('keystoreKeys', this.#keystoreKeys);
    }
    async exportKeyWithPasscode(keyAddress, keyType, passphrase) {
        await this.#initialLoadPromise;
        if (this.#mainKey === null)
            throw new Error('keystore: needs to be unlocked');
        const keys = this.#keystoreKeys;
        const storedKey = keys.find((x) => x.addr === keyAddress && x.type === keyType);
        if (!storedKey)
            throw new Error('keystore: key not found');
        if (storedKey.type !== 'internal')
            throw new Error('keystore: key does not have privateKey');
        const encryptedBytes = (0, ethers_1.getBytes)(storedKey.privKey);
        const counter = new aes_js_1.default.Counter(this.#mainKey.iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(this.#mainKey.key, counter);
        const decryptedBytes = aesCtr.decrypt(encryptedBytes);
        const decryptedPrivateKey = aes_js_1.default.utils.hex.fromBytes(decryptedBytes);
        const wallet = new ethers_1.Wallet(decryptedPrivateKey);
        const keyBackup = await wallet.encrypt(passphrase);
        return JSON.stringify(keyBackup);
    }
    async sendPrivateKeyToUi(keyAddress) {
        const decryptedPrivateKey = await this.#getPrivateKey(keyAddress);
        this.#windowManager.sendWindowUiMessage({ privateKey: `0x${decryptedPrivateKey}` });
    }
    async sendSeedToUi(id) {
        const decrypted = await this.getSavedSeed(id);
        this.#windowManager.sendWindowUiMessage({
            seed: decrypted.seed,
            seedPassphrase: decrypted.seedPassphrase
        });
    }
    async sendTempSeedToUi() {
        if (!this.#tempSeed)
            return;
        this.#windowManager.sendWindowUiMessage({ tempSeed: this.#tempSeed });
    }
    async #getPrivateKey(keyAddress) {
        await this.#initialLoadPromise;
        if (this.#mainKey === null)
            throw new Error('keystore: needs to be unlocked');
        const keys = this.#keystoreKeys;
        const storedKey = keys.find((x) => x.addr === keyAddress);
        if (!storedKey)
            throw new Error('keystore: key not found');
        if (storedKey.type !== 'internal')
            throw new Error('keystore: key does not have privateKey');
        // decrypt the pk of keyAddress with the keystore's key
        const encryptedBytes = (0, ethers_1.getBytes)(storedKey.privKey);
        const counter = new aes_js_1.default.Counter(this.#mainKey.iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(this.#mainKey.key, counter);
        // encrypt the pk of keyAddress with publicKey
        const decryptedBytes = aesCtr.decrypt(encryptedBytes);
        return aes_js_1.default.utils.hex.fromBytes(decryptedBytes);
    }
    /**
     * Export with public key encrypt
     *
     * @param keyAddress string - the address of the key you want to export
     * @param publicKey string - the public key, with which to asymmetrically encrypt it (used for key sync with other device's keystoreId)
     * @returns Encrypted
     */
    async exportKeyWithPublicKeyEncryption(keyAddress, publicKey) {
        const decryptedPrivateKey = await this.#getPrivateKey(keyAddress);
        const result = await (0, eth_crypto_1.encryptWithPublicKey)(publicKey, decryptedPrivateKey);
        return result;
    }
    async importKeyWithPublicKeyEncryption(encryptedSk, dedicatedToOneSA) {
        if (this.#mainKey === null)
            throw new Error('keystore: needs to be unlocked');
        const privateKey = await (0, eth_crypto_1.decryptWithPrivateKey)((0, ethers_1.hexlify)((0, ethers_1.getBytes)((0, ethers_1.concat)([this.#mainKey.key, this.#mainKey.iv]))), encryptedSk);
        if (!privateKey)
            throw new Error('keystore: wrong encryptedSk or private key');
        const keyToAdd = {
            addr: new ethers_1.Wallet(privateKey).address,
            privateKey,
            label: (0, keys_1.getDefaultKeyLabel)(this.keys, 0),
            type: 'internal',
            dedicatedToOneSA,
            meta: {
                createdAt: new Date().getTime()
            }
        };
        await this.addKeys([keyToAdd]);
    }
    async getSigner(keyAddress, keyType) {
        await this.#initialLoadPromise;
        const keys = this.#keystoreKeys;
        const storedKey = keys.find((x) => x.addr === keyAddress && x.type === keyType);
        if (!storedKey)
            throw new Error('keystore: key not found');
        const { addr, type, label, dedicatedToOneSA, meta } = storedKey;
        const key = {
            addr,
            type,
            label,
            dedicatedToOneSA,
            meta,
            isExternallyStored: type !== 'internal'
        };
        const SignerInitializer = this.#keystoreSigners[key.type];
        if (!SignerInitializer)
            throw new Error('keystore: unsupported signer type');
        if (key.type === 'internal') {
            if (!this.isUnlocked)
                throw new Error('keystore: not unlocked');
            const encryptedBytes = (0, ethers_1.getBytes)(storedKey.privKey);
            // @ts-ignore
            const counter = new aes_js_1.default.Counter(this.#mainKey.iv);
            // @ts-ignore
            const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(this.#mainKey.key, counter);
            const decryptedBytes = aesCtr.decrypt(encryptedBytes);
            const decryptedPrivateKey = aes_js_1.default.utils.hex.fromBytes(decryptedBytes);
            // @ts-ignore TODO: Figure out the correct type definition
            return new SignerInitializer(key, decryptedPrivateKey);
        }
        // @ts-ignore TODO: Figure out the correct type definition
        return new SignerInitializer(key);
    }
    async getSavedSeed(id) {
        await this.#initialLoadPromise;
        if (!this.isUnlocked)
            throw new Error('keystore: not unlocked');
        if (!this.#keystoreSeeds.length)
            throw new Error('keystore: no seed phrase added yet');
        const keystoreSeed = this.#keystoreSeeds.find((s) => s.id === id);
        if (!keystoreSeed)
            throw new Error(`keystore seed with id:${id} not found`);
        const encryptedSeedBytes = (0, ethers_1.getBytes)(keystoreSeed.seed);
        // @ts-ignore
        const counter = new aes_js_1.default.Counter(this.#mainKey.iv);
        // @ts-ignore
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(this.#mainKey.key, counter);
        const decryptedSeedBytes = aesCtr.decrypt(encryptedSeedBytes);
        const decryptedSeed = new TextDecoder().decode(decryptedSeedBytes);
        if (keystoreSeed.seedPassphrase) {
            const encryptedSeedPassphraseBytes = (0, ethers_1.getBytes)(keystoreSeed.seedPassphrase);
            const decryptedSeedPassphraseBytes = aesCtr.decrypt(encryptedSeedPassphraseBytes);
            const decryptedSeedPassphrase = new TextDecoder().decode(decryptedSeedPassphraseBytes);
            return {
                ...keystoreSeed,
                seed: decryptedSeed,
                seedPassphrase: decryptedSeedPassphrase
            };
        }
        return {
            ...keystoreSeed,
            seed: decryptedSeed,
            seedPassphrase: ''
        };
    }
    async #changeKeystorePassword(newSecret, oldSecret, extraEntropy) {
        await this.#initialLoadPromise;
        // In the case the user wants to change their device password,
        // they should also provide the previous password (oldSecret).
        //
        // However, in the case of KeyStore recovery, the user may have already forgotten the password,
        // but the Keystore is already unlocked with the recovery secret.
        // Therefore, in the last case, we can't provide the oldSecret, and we should not validate it.
        //
        // However, there is one problem if we leave it that way:
        //
        //     1. If the user recovers and unlocks the Keystore.
        //     2. But doesn't enter a new 'password' in the recovery flow (just closes the tab).
        //     3. And later decides to change the old password from Settings.
        //     4. Then they would not be able to do it because they don't know the old password.
        //
        // We are going to discuss it in the next meeting, but for now, we are leaving it as it is.
        // The long-term solution would be to refactor EmailVault recovery logic
        // and not unlock the Keystore with the recovery secret unless the user provides a new passphrase.
        if (oldSecret)
            await this.#unlockWithSecret('password', oldSecret);
        if (!this.isUnlocked)
            throw new EmittableError_1.default({
                message: 'App not unlocked. Please try again or contact support if the problem persists.',
                level: 'major',
                error: new Error('keystore: not unlocked')
            });
        await this.#removeSecret('password');
        await this.#addSecret('password', newSecret, extraEntropy, true);
    }
    async changeKeystorePassword(newSecret, oldSecret, extraEntropy) {
        await this.withStatus('changeKeystorePassword', () => this.#changeKeystorePassword(newSecret, oldSecret, extraEntropy));
    }
    async updateKeyPreferences(keys) {
        await this.withStatus('updateKeyPreferences', async () => this.#updateKeyPreferences(keys));
    }
    async #updateKeyPreferences(keys) {
        this.#keystoreKeys = this.#keystoreKeys.map((keystoreKey) => {
            const key = keys.find((k) => k.addr === keystoreKey.addr && k.type === keystoreKey.type);
            if (!key)
                return keystoreKey;
            return { ...keystoreKey, ...key.preferences };
        });
        await this.#storage.set('keystoreKeys', this.#keystoreKeys);
        this.emitUpdate();
    }
    resetErrorState() {
        this.errorMessage = '';
        this.emitUpdate();
    }
    get hasPasswordSecret() {
        return this.#keystoreSecrets.some((x) => x.id === 'password');
    }
    get hasKeystoreTempSeed() {
        return !!this.#tempSeed;
    }
    getAccountKeys(acc) {
        return this.keys.filter((key) => acc.associatedKeys.includes(key.addr));
    }
    getFeePayerKey(op) {
        const feePayerKeys = this.keys.filter((key) => key.addr === op.gasFeePayment.paidBy);
        const feePayerKey = 
        // Temporarily prioritize the key with the same type as the signing key.
        // TODO: Implement a way to choose the key type to broadcast with.
        feePayerKeys.find((key) => key.type === op.signingKeyType) || feePayerKeys[0];
        if (!feePayerKey) {
            const missingKeyAddr = (0, shortenAddress_1.default)(op.gasFeePayment.paidBy, 13);
            const accAddr = (0, shortenAddress_1.default)(op.accountAddr, 13);
            return new Error(`Key with address ${missingKeyAddr} for account with address ${accAddr} not found. 'Please try again or contact support if the problem persists.'`);
        }
        return feePayerKey;
    }
    isKeyIteratorInitializedWithTempSeed(keyIterator) {
        if (!this.#tempSeed || !keyIterator || keyIterator.subType !== 'seed')
            return false;
        return !!keyIterator.isSeedMatching && keyIterator.isSeedMatching(this.#tempSeed.seed);
    }
    async getKeystoreSeed(keyIterator) {
        if (!keyIterator || keyIterator.subType !== 'seed')
            return null;
        if (keyIterator.getEncryptedSeed) {
            const encryptedKeyIteratorSeed = await keyIterator.getEncryptedSeed(this.#getEncryptedSeedPhrase.bind(this));
            return (this.#keystoreSeeds.find((s) => s.seed === encryptedKeyIteratorSeed?.seed &&
                (s.seedPassphrase || '') === (encryptedKeyIteratorSeed?.passphrase || '')) || null);
        }
        return null;
    }
    async updateKeystoreKeys() {
        const keystoreKeys = await this.#storage.get('keystoreKeys', []);
        this.#keystoreKeys = keystoreKeys;
        this.emitUpdate();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            // includes the getters in the stringified instance
            isUnlocked: this.isUnlocked,
            keys: this.keys,
            seeds: this.seeds,
            hasPasswordSecret: this.hasPasswordSecret,
            hasKeystoreTempSeed: this.hasKeystoreTempSeed,
            hasTempSeed: this.hasTempSeed,
            isReadyToStoreKeys: this.isReadyToStoreKeys
        };
    }
}
exports.KeystoreController = KeystoreController;
//# sourceMappingURL=keystore.js.map