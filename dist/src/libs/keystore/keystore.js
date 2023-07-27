"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _Keystore_mainKey;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Keystore = void 0;
/* eslint-disable new-cap */
const aes_js_1 = __importDefault(require("aes-js"));
const ethers_1 = require("ethers");
const scrypt_js_1 = __importDefault(require("scrypt-js"));
const scryptDefaults = { N: 262144, r: 8, p: 1, dkLen: 64 };
const CIPHER = 'aes-128-ctr';
class Keystore {
    constructor(_storage, _keystoreSigners) {
        _Keystore_mainKey.set(this, void 0);
        this.storage = _storage;
        this.keystoreSigners = _keystoreSigners;
        __classPrivateFieldSet(this, _Keystore_mainKey, null, "f");
    }
    lock() {
        __classPrivateFieldSet(this, _Keystore_mainKey, null, "f");
    }
    isUnlocked() {
        return !!__classPrivateFieldGet(this, _Keystore_mainKey, "f");
    }
    async getMainKeyEncryptedWithSecrets() {
        return this.storage.get('keystoreSecrets', []);
    }
    async isReadyToStoreKeys() {
        return (await this.getMainKeyEncryptedWithSecrets()).length > 0;
    }
    async getKeyStoreUid() {
        const uid = await this.storage.get('keyStoreUid', null);
        if (!uid)
            throw new Error('keystore: adding secret before get uid');
        return uid;
    }
    // @TODO time before unlocking
    async unlockWithSecret(secretId, secret) {
        // @TODO should we check if already locked? probably not cause this function can  be used in order to verify if a secret is correct
        const secrets = await this.getMainKeyEncryptedWithSecrets();
        if (!secrets.length)
            throw new Error('keystore: no secrets yet');
        const secretEntry = secrets.find((x) => x.id === secretId);
        if (!secretEntry)
            throw new Error(`keystore: secret ${secretId} not found`);
        const { scryptParams, aesEncrypted } = secretEntry;
        if (aesEncrypted.cipherType !== CIPHER)
            throw Error(`keystore: unsupported cipherType ${aesEncrypted.cipherType}`);
        // @TODO: progressCallback?
        const key = await scrypt_js_1.default.scrypt(getBytesForSecret(secret), (0, ethers_1.getBytes)(scryptParams.salt), scryptParams.N, scryptParams.r, scryptParams.p, scryptParams.dkLen, () => { });
        const iv = (0, ethers_1.getBytes)(aesEncrypted.iv);
        const derivedKey = key.slice(0, 16);
        const macPrefix = key.slice(16, 32);
        const counter = new aes_js_1.default.Counter(iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(derivedKey, counter);
        const mac = (0, ethers_1.keccak256)((0, ethers_1.concat)([macPrefix, aesEncrypted.ciphertext]));
        if (mac !== aesEncrypted.mac)
            throw new Error('keystore: wrong secret');
        const decrypted = aesCtr.decrypt((0, ethers_1.getBytes)(aesEncrypted.ciphertext));
        __classPrivateFieldSet(this, _Keystore_mainKey, { key: decrypted.slice(0, 16), iv: decrypted.slice(16, 32) }, "f");
    }
    async addSecret(secretId, secret, extraEntropy = '') {
        const secrets = await this.getMainKeyEncryptedWithSecrets();
        // @TODO test
        if (secrets.find((x) => x.id === secretId))
            throw new Error(`keystore: trying to add duplicate secret ${secretId}`);
        let mainKey = __classPrivateFieldGet(this, _Keystore_mainKey, "f");
        // We are not not unlocked
        if (!mainKey) {
            if (!secrets.length) {
                const key = (0, ethers_1.getBytes)((0, ethers_1.keccak256)((0, ethers_1.concat)([(0, ethers_1.randomBytes)(32), (0, ethers_1.toUtf8Bytes)(extraEntropy)]))).slice(0, 16);
                mainKey = {
                    key,
                    iv: (0, ethers_1.randomBytes)(16)
                };
            }
            else
                throw new Error('keystore: must unlock keystore before adding secret');
        }
        const salt = (0, ethers_1.randomBytes)(32);
        const key = await scrypt_js_1.default.scrypt(getBytesForSecret(secret), salt, scryptDefaults.N, scryptDefaults.r, scryptDefaults.p, scryptDefaults.dkLen, () => { });
        const iv = (0, ethers_1.randomBytes)(16);
        const derivedKey = key.slice(0, 16);
        const macPrefix = key.slice(16, 32);
        const counter = new aes_js_1.default.Counter(iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(derivedKey, counter);
        const ciphertext = aesCtr.encrypt((0, ethers_1.getBytes)((0, ethers_1.concat)([mainKey.key, mainKey.iv])));
        const mac = (0, ethers_1.keccak256)((0, ethers_1.concat)([macPrefix, ciphertext]));
        secrets.push({
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
        await this.storage.set('keystoreSecrets', secrets);
        // produce uid if one doesn't exist (should be created when the first secret is added)
        if (!(await this.storage.get('keyStoreUid', null))) {
            const uid = (0, ethers_1.keccak256)(mainKey.key).slice(2, 34);
            await this.storage.set('keyStoreUid', uid);
        }
    }
    async removeSecret(secretId) {
        const secrets = await this.getMainKeyEncryptedWithSecrets();
        if (secrets.length <= 1)
            throw new Error('keystore: there would be no remaining secrets after removal');
        if (!secrets.find((x) => x.id === secretId))
            throw new Error(`keystore: secret$ ${secretId} not found`);
        await this.storage.set('keystoreSecrets', secrets.filter((x) => x.id !== secretId));
    }
    async getKeys() {
        const keys = await this.storage.get('keystoreKeys', []);
        return keys.map(({ id, label, type, meta }) => ({
            id,
            label,
            type,
            meta,
            isExternallyStored: type !== 'internal'
        }));
    }
    async addKeyExternallyStored(id, type, label, meta) {
        const keys = await this.storage.get('keystoreKeys', []);
        keys.push({
            id,
            type,
            label,
            meta,
            privKey: null
        });
        await this.storage.set('keystoreKeys', keys);
    }
    async addKey(privateKey, label) {
        if (__classPrivateFieldGet(this, _Keystore_mainKey, "f") === null)
            throw new Error('keystore: needs to be unlocked');
        // Set up the cipher
        const counter = new aes_js_1.default.Counter(__classPrivateFieldGet(this, _Keystore_mainKey, "f").iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(__classPrivateFieldGet(this, _Keystore_mainKey, "f").key, counter);
        // Store the key
        // Terminology: this private key represents an EOA wallet, which is why ethers calls it Wallet, but we treat it as a key here
        const wallet = new ethers_1.Wallet(privateKey);
        const keys = await this.storage.get('keystoreKeys', []);
        keys.push({
            id: wallet.address,
            type: 'internal',
            label,
            // @TODO: consider an MAC?
            privKey: (0, ethers_1.hexlify)(aesCtr.encrypt(aes_js_1.default.utils.hex.toBytes(privateKey))),
            meta: null
        });
        await this.storage.set('keystoreKeys', keys);
    }
    async removeKey(id) {
        if (!this.isUnlocked())
            throw new Error('keystore: not unlocked');
        const keys = await this.storage.get('keystoreKeys', []);
        if (!keys.find((x) => x.id === id))
            throw new Error(`keystore: trying to remove key that does not exist ${id}}`);
        this.storage.set('keystoreKeys', keys.filter((x) => x.id !== id));
    }
    async exportKeyWithPasscode(keyId, passphrase) {
        if (__classPrivateFieldGet(this, _Keystore_mainKey, "f") === null)
            throw new Error('keystore: needs to be unlocked');
        const keys = await this.storage.get('keystoreKeys', []);
        const storedKey = keys.find((x) => x.id === keyId);
        if (!storedKey)
            throw new Error('keystore: key not found');
        if (storedKey.type !== 'internal')
            throw new Error('keystore: key does not have privateKey');
        const encryptedBytes = (0, ethers_1.getBytes)(storedKey.privKey);
        const counter = new aes_js_1.default.Counter(__classPrivateFieldGet(this, _Keystore_mainKey, "f").iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(__classPrivateFieldGet(this, _Keystore_mainKey, "f").key, counter);
        const decryptedBytes = aesCtr.decrypt(encryptedBytes);
        const decryptedPrivateKey = aes_js_1.default.utils.hex.fromBytes(decryptedBytes);
        const wallet = new ethers_1.Wallet(decryptedPrivateKey);
        const keyBackup = await wallet.encrypt(passphrase);
        return JSON.stringify(keyBackup);
    }
    async getSigner(keyId) {
        const keys = await this.storage.get('keystoreKeys', []);
        const storedKey = keys.find((x) => x.id === keyId);
        if (!storedKey)
            throw new Error('keystore: key not found');
        const { id, label, type, meta } = storedKey;
        const key = {
            id,
            label,
            type,
            meta,
            isExternallyStored: type !== 'internal'
        };
        const signerInitializer = this.keystoreSigners[key.type];
        if (!signerInitializer)
            throw new Error('keystore: unsupported signer type');
        if (key.type === 'internal') {
            if (!this.isUnlocked())
                throw new Error('keystore: not unlocked');
            const encryptedBytes = (0, ethers_1.getBytes)(storedKey.privKey);
            // @ts-ignore
            const counter = new aes_js_1.default.Counter(__classPrivateFieldGet(this, _Keystore_mainKey, "f").iv);
            // @ts-ignore
            const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(__classPrivateFieldGet(this, _Keystore_mainKey, "f").key, counter);
            const decryptedBytes = aesCtr.decrypt(encryptedBytes);
            const decryptedPrivateKey = aes_js_1.default.utils.hex.fromBytes(decryptedBytes);
            return new signerInitializer(key, decryptedPrivateKey);
        }
        return new signerInitializer(key);
    }
}
exports.Keystore = Keystore;
_Keystore_mainKey = new WeakMap();
function getBytesForSecret(secret) {
    // see https://github.com/ethers-io/ethers.js/blob/v5/packages/json-wallets/src.ts/utils.ts#L19-L24
    return (0, ethers_1.toUtf8Bytes)(secret, 'NFKC');
}
//# sourceMappingURL=keystore.js.map