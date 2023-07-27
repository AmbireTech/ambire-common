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
var _EmailVaultController_instances, _EmailVaultController_isWaitingEmailConfirmation, _EmailVaultController_emailVault, _EmailVaultController_magicLinkLifeTime, _EmailVaultController_magicLinkKeys, _EmailVaultController_sessionKeys, _EmailVaultController_fetch, _EmailVaultController_relayerUrl, _EmailVaultController_keyStore, _EmailVaultController_verifiedMagicLinkKey, _EmailVaultController_requestNewMagicLinkKey, _EmailVaultController_getSessionKey, _EmailVaultController_getMagicLinkKey, _EmailVaultController_addKeyStoreSecretProceed, _EmailVaultController_getRecoverKeyStoreSecretProceed;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailVaultController = exports.EmailVaultState = void 0;
const crypto_1 = __importDefault(require("crypto"));
const emailVault_1 = require("../libs/emailVault/emailVault");
const magicLink_1 = require("../libs/magicLink/magicLink");
const emailVault_2 = require("../interfaces/emailVault");
const eventEmitter_1 = __importDefault(require("./eventEmitter"));
var EmailVaultState;
(function (EmailVaultState) {
    EmailVaultState[EmailVaultState["Loading"] = 0] = "Loading";
    EmailVaultState[EmailVaultState["WaitingEmailConfirmation"] = 1] = "WaitingEmailConfirmation";
    EmailVaultState[EmailVaultState["Ready"] = 2] = "Ready";
})(EmailVaultState = exports.EmailVaultState || (exports.EmailVaultState = {}));
const RECOVERY_SECRET_ID = 'EmailVaultRecoverySecret';
const EMAIL_VAULT_STORAGE_KEY = 'emailVault';
const MAGIC_LINK_STORAGE_KEY = 'magicLinkKeys';
const SESSION_KEYS_STORAGE_KEY = 'sessionKeys';
class EmailVaultController extends eventEmitter_1.default {
    constructor(storage, fetch, relayerUrl, keyStore) {
        super();
        _EmailVaultController_instances.add(this);
        _EmailVaultController_isWaitingEmailConfirmation.set(this, false);
        _EmailVaultController_emailVault.set(this, void 0);
        _EmailVaultController_magicLinkLifeTime.set(this, 300000);
        _EmailVaultController_magicLinkKeys.set(this, {});
        _EmailVaultController_sessionKeys.set(this, {});
        _EmailVaultController_fetch.set(this, void 0);
        _EmailVaultController_relayerUrl.set(this, void 0);
        _EmailVaultController_keyStore.set(this, void 0);
        this.isReady = false;
        this.lastUpdate = new Date();
        this.emailVaultStates = {};
        __classPrivateFieldSet(this, _EmailVaultController_fetch, fetch, "f");
        __classPrivateFieldSet(this, _EmailVaultController_relayerUrl, relayerUrl, "f");
        this.storage = storage;
        __classPrivateFieldSet(this, _EmailVaultController_emailVault, new emailVault_1.EmailVault(fetch, relayerUrl), "f");
        __classPrivateFieldSet(this, _EmailVaultController_keyStore, keyStore, "f");
        this.initialLoadPromise = this.load();
    }
    async load() {
        this.isReady = false;
        const result = await Promise.all([
            this.storage.get(EMAIL_VAULT_STORAGE_KEY, {}),
            this.storage.get(MAGIC_LINK_STORAGE_KEY, {})
        ]);
        this.emailVaultStates = result[0];
        __classPrivateFieldSet(this, _EmailVaultController_magicLinkKeys, result[1], "f");
        this.lastUpdate = new Date();
        this.isReady = true;
        this.emitUpdate();
    }
    getCurrentState() {
        if (!this.isReady)
            return EmailVaultState.Loading;
        if (__classPrivateFieldGet(this, _EmailVaultController_isWaitingEmailConfirmation, "f"))
            return EmailVaultState.WaitingEmailConfirmation;
        return EmailVaultState.Ready;
    }
    async backupRecoveryKeyStoreSecret(email) {
        if (!this.emailVaultStates[email]) {
            await this.login(email);
        }
        const newSecret = crypto_1.default.randomBytes(32).toString('base64url');
        await __classPrivateFieldGet(this, _EmailVaultController_keyStore, "f").addSecret(RECOVERY_SECRET_ID, newSecret);
        const keyStoreUid = await __classPrivateFieldGet(this, _EmailVaultController_keyStore, "f").getKeyStoreUid();
        const existsMagicKey = await __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_getMagicLinkKey).call(this, email);
        const magicKey = existsMagicKey || (await __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_requestNewMagicLinkKey).call(this, email));
        if (magicKey.confirmed) {
            await __classPrivateFieldGet(this, _EmailVaultController_emailVault, "f").addKeyStoreSecret(email, magicKey.key, keyStoreUid, newSecret);
        }
        await this.polling(__classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_addKeyStoreSecretProceed).bind(this), [
            email,
            magicKey.key,
            keyStoreUid,
            newSecret
        ]);
        // await this.getEmailVaultInfo(email, magicKey.key)
    }
    async recoverKeyStore(email) {
        if (!this.emailVaultStates[email]) {
            await this.login(email);
        }
        const keyStoreUid = await __classPrivateFieldGet(this, _EmailVaultController_keyStore, "f").getKeyStoreUid();
        const availableSecrets = this.emailVaultStates[email].availableSecrets;
        const keyStoreSecret = Object.keys(availableSecrets).find(async (secretKey) => {
            return availableSecrets[secretKey].key === keyStoreUid;
        });
        if (this.emailVaultStates[email] && keyStoreSecret) {
            const secretKey = await this.getRecoverKeyStoreSecret(email, keyStoreUid);
            await __classPrivateFieldGet(this, _EmailVaultController_keyStore, "f").unlockWithSecret(RECOVERY_SECRET_ID, secretKey.value);
        }
    }
    async getRecoverKeyStoreSecret(email, uid) {
        const state = this.emailVaultStates;
        if (!state[email] ||
            !state[email].availableSecrets[uid] ||
            state[email].availableSecrets[uid].type !== emailVault_2.SecretType.KeyStore)
            return;
        const existsMagicKey = await __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_getMagicLinkKey).call(this, email);
        const key = existsMagicKey || (await __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_requestNewMagicLinkKey).call(this, email));
        if (key.confirmed) {
            return __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_getRecoverKeyStoreSecretProceed).call(this, email, uid);
        }
        return this.polling(__classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_getRecoverKeyStoreSecretProceed).bind(this), [email, uid]);
    }
    async login(email) {
        const [existsSessionKey, existsMagicKey] = await Promise.all([
            __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_getSessionKey).call(this, email),
            __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_getMagicLinkKey).call(this, email)
        ]);
        const magicLinkKey = existsMagicKey || (await __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_requestNewMagicLinkKey).call(this, email));
        const key = existsSessionKey || magicLinkKey.key;
        if (existsSessionKey || magicLinkKey.confirmed) {
            await this.getEmailVaultInfo(email, key);
        }
        else {
            await this.polling(this.getEmailVaultInfo.bind(this), [email, key]);
        }
    }
    async getEmailVaultInfo(email, key) {
        __classPrivateFieldSet(this, _EmailVaultController_isWaitingEmailConfirmation, true, "f");
        // ToDo if result not success
        const result = await __classPrivateFieldGet(this, _EmailVaultController_emailVault, "f")
            .getEmailVaultInfo(email, key)
            .catch(() => null);
        if (!result) {
            this.emitUpdate();
            return false;
        }
        this.emailVaultStates[email] = result;
        this.storage.set(EMAIL_VAULT_STORAGE_KEY, this.emailVaultStates);
        // this will trigger the update event
        __classPrivateFieldSet(this, _EmailVaultController_isWaitingEmailConfirmation, false, "f");
        await __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_verifiedMagicLinkKey).call(this, email);
        this.emitUpdate();
        return true;
    }
    async polling(fn, params) {
        setTimeout(async () => {
            const result = await fn(...params);
            if (result)
                return result;
            return this.polling(fn, params);
        }, 2000);
    }
}
exports.EmailVaultController = EmailVaultController;
_EmailVaultController_isWaitingEmailConfirmation = new WeakMap(), _EmailVaultController_emailVault = new WeakMap(), _EmailVaultController_magicLinkLifeTime = new WeakMap(), _EmailVaultController_magicLinkKeys = new WeakMap(), _EmailVaultController_sessionKeys = new WeakMap(), _EmailVaultController_fetch = new WeakMap(), _EmailVaultController_relayerUrl = new WeakMap(), _EmailVaultController_keyStore = new WeakMap(), _EmailVaultController_instances = new WeakSet(), _EmailVaultController_verifiedMagicLinkKey = async function _EmailVaultController_verifiedMagicLinkKey(email) {
    if (!__classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email])
        return;
    __classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email].confirmed = true;
    __classPrivateFieldGet(this, _EmailVaultController_sessionKeys, "f")[email] = await __classPrivateFieldGet(this, _EmailVaultController_emailVault, "f").getSessionKey(email, __classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email].key);
    await Promise.all([
        this.storage.set(MAGIC_LINK_STORAGE_KEY, __classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")),
        this.storage.set(SESSION_KEYS_STORAGE_KEY, __classPrivateFieldGet(this, _EmailVaultController_sessionKeys, "f")),
        this.getEmailVaultInfo(email, __classPrivateFieldGet(this, _EmailVaultController_sessionKeys, "f")[email])
    ]);
}, _EmailVaultController_requestNewMagicLinkKey = async function _EmailVaultController_requestNewMagicLinkKey(email) {
    await this.initialLoadPromise;
    const result = await (0, magicLink_1.requestMagicLink)(email, __classPrivateFieldGet(this, _EmailVaultController_relayerUrl, "f"), __classPrivateFieldGet(this, _EmailVaultController_fetch, "f"));
    __classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email] = {
        key: result.key,
        requestedAt: new Date(),
        confirmed: !!result.secret
    };
    this.storage.set(MAGIC_LINK_STORAGE_KEY, __classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f"));
    return __classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email];
}, _EmailVaultController_getSessionKey = async function _EmailVaultController_getSessionKey(email) {
    await this.initialLoadPromise;
    return __classPrivateFieldGet(this, _EmailVaultController_sessionKeys, "f")[email];
}, _EmailVaultController_getMagicLinkKey = async function _EmailVaultController_getMagicLinkKey(email) {
    await this.initialLoadPromise;
    const result = __classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email];
    if (!result)
        return null;
    if (new Date().getTime() - result.requestedAt.getTime() > __classPrivateFieldGet(this, _EmailVaultController_magicLinkLifeTime, "f"))
        return null;
    return result;
}, _EmailVaultController_addKeyStoreSecretProceed = async function _EmailVaultController_addKeyStoreSecretProceed(email, magicKey, keyStoreUid, newSecret) {
    __classPrivateFieldSet(this, _EmailVaultController_isWaitingEmailConfirmation, true, "f");
    if (!__classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email]) {
        this.emitUpdate();
        return false;
    }
    const result = await __classPrivateFieldGet(this, _EmailVaultController_emailVault, "f")
        .addKeyStoreSecret(email, magicKey, keyStoreUid, newSecret)
        .catch(() => null);
    if (!result) {
        this.emitUpdate();
        return false;
    }
    __classPrivateFieldSet(this, _EmailVaultController_isWaitingEmailConfirmation, false, "f");
    await __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_verifiedMagicLinkKey).call(this, email);
    return true;
}, _EmailVaultController_getRecoverKeyStoreSecretProceed = async function _EmailVaultController_getRecoverKeyStoreSecretProceed(email, uid) {
    __classPrivateFieldSet(this, _EmailVaultController_isWaitingEmailConfirmation, true, "f");
    if (!__classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email]) {
        this.emitUpdate();
        return false;
    }
    const result = await __classPrivateFieldGet(this, _EmailVaultController_emailVault, "f")
        .retrieveKeyStoreSecret(email, __classPrivateFieldGet(this, _EmailVaultController_magicLinkKeys, "f")[email].key, uid)
        .catch(() => null);
    if (!result) {
        this.emitUpdate();
        return false;
    }
    __classPrivateFieldSet(this, _EmailVaultController_isWaitingEmailConfirmation, false, "f");
    await __classPrivateFieldGet(this, _EmailVaultController_instances, "m", _EmailVaultController_verifiedMagicLinkKey).call(this, email);
    this.emitUpdate();
    return result;
};
//# sourceMappingURL=emailVault.js.map