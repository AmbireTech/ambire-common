"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeystoreController = exports.STATUS_WRAPPED_METHODS = void 0;
const tslib_1 = require("tslib");
const aes_js_1 = tslib_1.__importDefault(require("aes-js"));
const eth_crypto_1 = require("eth-crypto");
const ethers_1 = require("ethers");
const keystore_1 = require("../../libs/keystore/keystore");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const derivation_1 = require("../../consts/derivation");
const privacyPools_1 = require("../../consts/privacyPools");
const entropyGenerator_1 = require("../../libs/entropyGenerator/entropyGenerator");
const keys_1 = require("../../libs/keys/keys");
const scryptAdapter_1 = require("../../libs/scrypt/scryptAdapter");
const shortenAddress_1 = tslib_1.__importDefault(require("../../utils/shortenAddress"));
const uuid_1 = require("../../utils/uuid");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const KEYSTORE_UNEXPECTED_ERROR_MESSAGE = 'Keystore unexpected error. If the problem persists, please contact support.';
exports.STATUS_WRAPPED_METHODS = {
    unlockWithSecret: 'INITIAL',
    verifySecret: 'INITIAL',
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
    /**
     * Whether the stored recovery phrases have been read. False if reading failed, when `seeds` may
     * be wrongly empty, so nothing may be dropped for a phrase missing from it.
     */
    areSeedsLoaded = false;
    #tempSeed = null;
    #keystoreSigners;
    #keystoreKeys = [];
    #internalKeysToAddOnKeystoreReady = [];
    #externalKeysToAddOnKeystoreReady = [];
    #seedsToAddOnKeystoreReady = [];
    keyStoreUid;
    #isReadyToStoreKeys = false;
    errorMessage = '';
    /**
     * The outcome of the last `verifySecret` call. Unlike a status, it survives until the UI
     * resets it, so a re-authentication prompt can read the result no matter when it re-renders.
     */
    signingAuthResult = null;
    /**
     * Stamped on every `signingAuthResult` and read nowhere else. It only makes two identical
     * outcomes differ, so the UI's reconciled state still re-renders on the second one - keep it.
     */
    #signingAuthResultId = 0;
    /** Set while `verifySecret` runs, so the shared unlock `errorMessage` is left alone. */
    #isVerifyingSecret = false;
    statuses = exports.STATUS_WRAPPED_METHODS;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    #ui;
    #scryptAdapter;
    constructor(platform, _storage, _keystoreSigners, ui, eventEmitterRegistry) {
        super(eventEmitterRegistry);
        this.#storage = _storage;
        this.#keystoreSigners = _keystoreSigners;
        this.#mainKey = null;
        this.keyStoreUid = null;
        this.#ui = ui;
        this.#scryptAdapter = new scryptAdapter_1.ScryptAdapter(platform);
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
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
            this.areSeedsLoaded = true;
            this.#keystoreKeys = keystoreKeys;
        }
        catch (e) {
            this.emitError({
                message: 'Something went wrong when loading the Keystore. Please try again or contact support if the problem persists.',
                level: 'major',
                error: e
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
        this.#seedsToAddOnKeystoreReady = [];
        this.#internalKeysToAddOnKeystoreReady = [];
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
    }
    async getKeyStoreUid() {
        const uid = this.keyStoreUid;
        if (!uid)
            throw new Error('keystore: adding secret before get uid');
        return uid;
    }
    // @TODO time before unlocking
    async #unlockWithSecret(secretId, secret) {
        await this.initialLoadPromise;
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
        if (aesEncrypted.cipherType !== keystore_1.CIPHER &&
            aesEncrypted.cipherType !== keystore_1.CIPHER_OLD &&
            // @ts-ignore
            aesEncrypted.cipherType !== undefined) {
            throw new EmittableError_1.default({
                message: 'Something went wrong when trying to unlock Ambire. Please try again or contact support if the problem persists.',
                level: 'major',
                // @ts-ignore
                error: new Error(`keystore: unsupported cipherType ${aesEncrypted.cipherType}`)
            });
        }
        const secretKey = await (0, keystore_1.deriveSecret)(this.#scryptAdapter, secret, scryptParams);
        const isOldSecretCipher = aesEncrypted.cipherType === undefined || aesEncrypted.cipherType === keystore_1.CIPHER_OLD;
        if (isOldSecretCipher) {
            // 1. Retrieve the main key using the old encryption method
            const mainKeyOld = this.#unlockWithSecretOld(secretKey, secretEntry);
            // Rebuild the new main key from the old one.
            // `mainKeyOld` is the previous 128-bit key (16 bytes), while the new encryption scheme
            // needs a 256-bit main key (32 bytes).
            // We cannot generate a new random key here, because the user may have more than one secret
            // and we need to be able to recreate the same main key again if another secret is migrated later.
            //
            // We simply concatenate `mainKeyOld.key` and `mainKeyOld.iv` (16 bytes each, 32 bytes total).
            this.#mainKey = await crypto.subtle.importKey('raw', new Uint8Array((0, ethers_1.getBytes)((0, ethers_1.concat)([mainKeyOld.key, mainKeyOld.iv]))), { name: keystore_1.CIPHER }, true, ['encrypt', 'decrypt']);
            // 3. Migrate the secret and all stored seeds/pks to use GCM, then persist everything
            // together once both migrations have completed.
            try {
                const migratedSecrets = await this.#migrateSecretToGCM(secretEntry.id, secretKey);
                const { migratedKeys, migratedSeeds, hasMigrated } = await this.#migrateStoredPayloadsToGCMIfNeeded();
                await this.#persistMigratedKeystoreData({
                    secrets: migratedSecrets,
                    keys: hasMigrated ? migratedKeys : undefined,
                    seeds: hasMigrated ? migratedSeeds : undefined
                });
            }
            catch (e) {
                this.emitError({
                    message: 'Keystore migration to GCM failed.',
                    level: 'silent',
                    error: e instanceof Error ? e : new Error('keystore: GCM migration failed')
                });
            }
        }
        else {
            await this.#unlockWithSecretGCM(secretKey, secretEntry);
            // The secret is already on GCM, but stored keys/seeds may still be on AES-CTR if a previous
            // migration was interrupted or partially failed. Retry here so the migration eventually
            // completes; it's a no-op when there is nothing left to migrate.
            try {
                const { migratedKeys, migratedSeeds, hasMigrated } = await this.#migrateStoredPayloadsToGCMIfNeeded();
                if (hasMigrated) {
                    await this.#persistMigratedKeystoreData({ keys: migratedKeys, seeds: migratedSeeds });
                }
            }
            catch (e) {
                this.emitError({
                    message: 'Keystore migration to GCM failed.',
                    level: 'silent',
                    error: e instanceof Error ? e : new Error('keystore: GCM migration failed')
                });
            }
        }
    }
    /**
     * Used only once to decrypt the main key with AES-CTR, in order to migrate the secrets and stored keys/seeds to AES-GCM.
     */
    #unlockWithSecretOld(secretKey, secretEntry) {
        const aesEncrypted = secretEntry.aesEncrypted;
        if (aesEncrypted.cipherType !== undefined && aesEncrypted.cipherType !== keystore_1.CIPHER_OLD) {
            throw new Error('keystore: invalid old secret cipher type');
        }
        const iv = (0, ethers_1.getBytes)(aesEncrypted.iv);
        const derivedKey = secretKey.slice(0, 16);
        const macPrefix = secretKey.slice(16, 32);
        const counter = new aes_js_1.default.Counter(iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(derivedKey, counter);
        const mac = (0, ethers_1.keccak256)((0, ethers_1.concat)([macPrefix, aesEncrypted.ciphertext]));
        if ('mac' in aesEncrypted && mac !== aesEncrypted.mac) {
            this.errorMessage = 'Incorrect password. Please try again.';
            this.emitUpdate();
            const error = new Error(this.errorMessage);
            throw new EmittableError_1.default({
                level: 'silent',
                message: this.errorMessage,
                error,
                sendCrashReport: false
            });
        }
        this.errorMessage = '';
        const decrypted = aesCtr.decrypt((0, ethers_1.getBytes)(aesEncrypted.ciphertext));
        return {
            key: decrypted.slice(0, 16),
            iv: decrypted.slice(16, 32)
        };
    }
    /**
     * Used for all unlocks, unless the user hasn't unlocked and migrated the keystore since the AES-GCM migration was implemented.
     */
    async #unlockWithSecretGCM(secretKey, secretEntry) {
        if (secretEntry.aesEncrypted.cipherType !== keystore_1.CIPHER) {
            throw new Error('keystore: invalid gcm secret cipher type');
        }
        this.#mainKey = await this.#decryptMainKeyWithSecret(secretKey, secretEntry.aesEncrypted);
        this.errorMessage = '';
    }
    /**
     * Unwraps the main key of another device from a scanned app data sync payload, with the
     * same wrong password handling as unlocking this device.
     */
    async #unwrapSyncedMainKey(secretKey, aesEncrypted) {
        return this.#decryptMainKeyWithSecret(secretKey, aesEncrypted, keystore_1.decryptSyncedMainKeyWithSecret);
    }
    /**
     * Decrypts a main key wrapped with the provided secret, translating a wrong
     * secret into the user facing "Incorrect password" error. Used both when
     * unlocking this device and when importing keys synced from another device
     * (where the main key of the other device gets unwrapped with its password).
     */
    async #decryptMainKeyWithSecret(secretKey, aesEncrypted, decrypt = keystore_1.decryptMainKeyWithSecret) {
        try {
            return await decrypt(secretKey, aesEncrypted);
        }
        catch (error) {
            // The unwrap marks the one failure the user can act on - the key not matching the ciphertext
            // - so a broken platform is no longer reported to them as a wrong password
            if (error instanceof keystore_1.WrongSecretError) {
                // A verification carries its outcome in `signingAuthResult`, so it must not write the
                // message the unlock screen reads
                if (!this.#isVerifyingSecret) {
                    this.errorMessage = 'Incorrect password. Please try again.';
                    this.emitUpdate();
                }
                throw new EmittableError_1.default({
                    level: 'silent',
                    message: 'Incorrect password. Please try again.',
                    error: error.thrown instanceof Error ? error.thrown : error,
                    sendCrashReport: false
                });
            }
            throw new EmittableError_1.default({
                level: 'major',
                message: 'Something went wrong when trying to unlock. Please try again or contact support if the problem persists.',
                error: error instanceof Error ? error : new Error('keystore: unexpected error during GCM unlock')
            });
        }
    }
    async #findStoredSeed(seed, seedPassphrase) {
        const normalizedSeed = ethers_1.Mnemonic.fromPhrase(seed).phrase;
        const normalizedPassphrase = seedPassphrase || '';
        for (const storedSeed of this.#keystoreSeeds) {
            const decryptedStoredSeed = await this.getSavedSeed(storedSeed.id);
            if (decryptedStoredSeed.seed !== normalizedSeed)
                continue;
            if ((decryptedStoredSeed.seedPassphrase || '') !== normalizedPassphrase)
                continue;
            return storedSeed;
        }
        return null;
    }
    /**
     * Used to migrate a specific secret to GCM. Secrets have to be migrated separately, because
     * they are encrypted with unique secrets, which we need from the user in order to be able to migrate them.
     *
     * At this point we have already validated that the provided secret is correct and we have the main key
     * decrypted in memory, so we just need to re-encrypt it with GCM using the secret
     */
    async #migrateSecretToGCM(secretId, secretKey) {
        return Promise.all(this.#keystoreSecrets.map(async (secret) => {
            if (secret.id !== secretId)
                return secret;
            const encrypted = await (0, keystore_1.encryptMainKeyWithSecret)(this.#mainKey, secretKey);
            return {
                ...secret,
                aesEncrypted: encrypted
            };
        }));
    }
    /**
     * Re-encrypts all AES-CTR stored keys and seeds to AES-GCM. It does not persist anything itself,
     * so the caller can persist the result together with the migrated secret in a single step.
     * `hasMigrated` indicates whether anything was actually re-encrypted, so the caller can skip
     * persisting (and avoid pointless storage writes) when there was nothing left to migrate.
     */
    async #migrateStoredPayloadsToGCMIfNeeded() {
        if (!this.#mainKey)
            throw new Error('keystore: needs to be unlocked');
        const { migratedKeys, migratedSeeds, failedMigrations, hasMigrated } = await (0, keystore_1.migrateStoredPayloadsToGCM)(this.#mainKey, this.#keystoreKeys, this.#keystoreSeeds);
        if (failedMigrations.keyAddrs.length || failedMigrations.seedIds.length) {
            this.emitError({
                message: `Failed to migrate ${failedMigrations.keyAddrs.length} keys and ${failedMigrations.seedIds.length} seeds to AES-GCM encryption.`,
                level: 'silent',
                error: new Error(`keystore: failed to migrate ${failedMigrations.keyAddrs.length} keys and ${failedMigrations.seedIds.length} seeds to AES-GCM encryption`)
            });
        }
        return { migratedKeys, migratedSeeds, hasMigrated };
    }
    /**
     * Persists the migrated keystore data and updates the in-memory state in one place.
     * Only the provided slices are written, so callers persist exactly what they migrated.
     */
    async #persistMigratedKeystoreData({ secrets, keys, seeds }) {
        if (secrets) {
            await this.#storage.set('keystoreSecrets', secrets);
            this.#keystoreSecrets = secrets;
        }
        if (keys) {
            await this.#storage.set('keystoreKeys', keys);
            this.#keystoreKeys = keys;
        }
        if (seeds) {
            await this.#storage.set('keystoreSeeds', seeds);
            this.#keystoreSeeds = seeds;
        }
    }
    async unlockWithSecret(secretId, secret) {
        await this.withStatus('unlockWithSecret', () => this.#unlockWithSecret(secretId, secret), true);
    }
    /**
     * Re-checks a secret on an already unlocked keystore, so the user can prove their identity before
     * signing. Goes through the unlock path, which is a no-op for the lock state when unlocked.
     */
    async verifySecret(secretId, secret) {
        await this.withStatus('verifySecret', async () => {
            this.signingAuthResult = null;
            this.#signingAuthResultId += 1;
            const id = this.#signingAuthResultId;
            this.#isVerifyingSecret = true;
            try {
                await this.#unlockWithSecret(secretId, secret);
                this.signingAuthResult = { status: 'success', error: null, id };
            }
            catch (e) {
                this.signingAuthResult = {
                    status: 'failed',
                    error: e?.message || 'Could not confirm your identity. Please try again.',
                    id
                };
                // Re-thrown so a wrong secret keeps being reported the way unlocking reports it
                throw e;
            }
            finally {
                this.#isVerifyingSecret = false;
            }
        }, true);
    }
    resetSigningAuthResult() {
        if (!this.signingAuthResult)
            return;
        // Only the verification's own outcome is cleared - the shared `errorMessage` belongs to the
        // unlock screen, and wiping it here cleared an error the user had not read yet
        this.signingAuthResult = null;
        this.emitUpdate();
    }
    async #addSecret(secretId, secret, extraEntropy = '', leaveUnlocked = false) {
        await this.initialLoadPromise;
        // @TODO test
        if (this.#keystoreSecrets.find((x) => x.id === secretId))
            throw new EmittableError_1.default({
                message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
                level: 'major',
                error: new Error(`keystore: trying to add duplicate secret ${secretId}`)
            });
        let mainKey = this.#mainKey;
        // We are not unlocked
        if (!mainKey) {
            if (!this.#keystoreSecrets.length) {
                // Generate a new main key if this is the first secret being added
                const generatedMainKey = new entropyGenerator_1.EntropyGenerator().generateRandomBytes(32, extraEntropy);
                mainKey = await crypto.subtle.importKey('raw', new Uint8Array(generatedMainKey), { name: keystore_1.CIPHER, length: 256 }, true, ['encrypt', 'decrypt']);
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
        const entropyGenerator = new entropyGenerator_1.EntropyGenerator();
        const salt = entropyGenerator.generateRandomBytes(32, extraEntropy);
        const scryptParams = { salt: (0, ethers_1.hexlify)(salt), ...keystore_1.SCRYPT_PARAMS };
        const secretKey = await (0, keystore_1.deriveSecret)(this.#scryptAdapter, secret, scryptParams);
        const mainKeyEncryptedWithSecret = await (0, keystore_1.encryptMainKeyWithSecret)(mainKey, secretKey);
        this.#keystoreSecrets.push({
            id: secretId,
            scryptParams,
            aesEncrypted: mainKeyEncryptedWithSecret
        });
        // Persist the new secrets
        await this.#storage.set('keystoreSecrets', this.#keystoreSecrets);
        // produce uid if one doesn't exist (should be created when the first secret is added)
        if (!this.keyStoreUid) {
            const exportedMainKeyUint8Array = new Uint8Array(await crypto.subtle.exportKey('raw', mainKey));
            const privateKeyHex = (0, ethers_1.hexlify)(exportedMainKeyUint8Array);
            const uid = (0, eth_crypto_1.publicKeyByPrivateKey)(privateKeyHex);
            this.keyStoreUid = uid;
            await this.#storage.set('keyStoreUid', uid);
        }
        this.isReadyToStoreKeys = true;
        // Awaited, so that the caller can rely on the synced keys being stored by the time
        // this resolves. Otherwise the accounts added by the sync stay without their keys
        // for a while
        await this.#addQueuedKeysAndSeeds();
    }
    async addSecret(secretId, secret, extraEntropy, leaveUnlocked) {
        await this.withStatus('addSecret', () => this.#addSecret(secretId, secret, extraEntropy, leaveUnlocked), true);
    }
    async #removeSecret(secretId) {
        await this.initialLoadPromise;
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
        return this.#keystoreSeeds.map(({ id, label, hdPathTemplate, seedPassphrase, notBackedUp }) => ({
            id,
            label: label || 'Unnamed Recovery Seed',
            hdPathTemplate,
            withPassphrase: !!seedPassphrase,
            notBackedUp
        }));
    }
    async addTempSeed({ seed, seedPassphrase, hdPathTemplate, notBackedUp }) {
        const validHdPath = derivation_1.DERIVATION_OPTIONS.some((o) => o.value === hdPathTemplate);
        if (!validHdPath)
            throw new EmittableError_1.default({
                message: 'Incorrect derivation path when trying to update the temp seed. Please contact support',
                level: 'major',
                error: new Error('keystore: hd path to temp seed incorrect')
            });
        this.#tempSeed = { seed, seedPassphrase, hdPathTemplate, notBackedUp };
        this.emitUpdate();
    }
    /**
     * Generates a brand new phrase without revealing it to the user. It is marked as
     * not backed up, so the app can prompt for a backup once the account holds funds.
     * Returns the generated temp seed, so the background can derive accounts from it
     * without the phrase ever reaching the UI.
     */
    async generateTempSeed({ extraEntropy }) {
        this.#tempSeed = this.#generateNotBackedUpSeed(extraEntropy);
        this.emitUpdate();
        return this.#tempSeed;
    }
    /**
     * Generates and stores a recovery phrase flagged as not backed up, returning its id. For a
     * Privacy Pools-only phrase: unlike `generateTempSeed`, it never touches the temp seed another
     * flow may be holding.
     */
    async addGeneratedSeed({ extraEntropy }) {
        const [seedId] = await this.#addSeeds([this.#generateNotBackedUpSeed(extraEntropy)]);
        if (!seedId)
            throw new EmittableError_1.default({
                message: 'The new recovery phrase could not be saved. Please try again.',
                level: 'major',
                error: new Error('keystore: the generated seed was not stored')
            });
        return seedId;
    }
    /**
     * Generates a new 12-word phrase on the standard derivation path, flagged as not backed up
     * since the user has not seen it yet.
     */
    #generateNotBackedUpSeed(extraEntropy) {
        const seed = new entropyGenerator_1.EntropyGenerator().generateRandomMnemonic(12, extraEntropy || '').phrase;
        return { seed, hdPathTemplate: derivation_1.BIP44_STANDARD_DERIVATION_TEMPLATE, notBackedUp: true };
    }
    deleteTempSeed(shouldUpdate = true) {
        this.#tempSeed = null;
        if (shouldUpdate)
            this.emitUpdate();
    }
    async persistTempSeed() {
        if (!this.#tempSeed)
            return;
        await this.#addSeeds([this.#tempSeed]);
        this.#tempSeed = null;
        this.emitUpdate();
    }
    /**
     * Adds seeds to the keystore in a single storage write and returns the ids they are
     * stored with, in the order they were passed. An `id` can be passed per seed to
     * preserve the id it already had on another device (app data sync), so that the
     * synced keys' `meta.fromSeedId` keeps pointing to it.
     */
    async #addSeeds(seedsToAdd, shouldEmitUpdate = true) {
        await this.initialLoadPromise;
        if (!seedsToAdd.length)
            return [];
        if (this.#mainKey === null)
            throw new EmittableError_1.default({
                message: KEYSTORE_UNEXPECTED_ERROR_MESSAGE,
                level: 'major',
                error: new Error('keystore: needs to be unlocked')
            });
        if (seedsToAdd.some(({ seed }) => !ethers_1.Mnemonic.isValidMnemonic(seed))) {
            throw new EmittableError_1.default({
                message: 'The provided seed phrase is invalid. Try again with a valid seed or contact support if you think this is a mistake.',
                level: 'expected',
                error: new Error('keystore: trying to add an invalid seed phrase')
            });
        }
        const seedsBeforeAdd = [...this.#keystoreSeeds];
        const ids = [];
        try {
            // Entries are pushed as they are built, so that duplicates and labels are
            // resolved against the seeds added earlier in the same batch as well
            for (const { seed, seedPassphrase, hdPathTemplate, notBackedUp, id } of seedsToAdd) {
                const existingEntry = await this.#findStoredSeed(seed, seedPassphrase);
                if (existingEntry) {
                    ids.push(existingEntry.id);
                    continue;
                }
                const newEntry = {
                    id: id || (0, uuid_1.generateUuid)(),
                    label: `Recovery Phrase ${this.#keystoreSeeds.length + 1}`,
                    seed: await (0, keystore_1.encryptWithKey)(this.#mainKey, (0, keystore_1.extractEntropyFromSeed)(seed)),
                    seedPassphrase: seedPassphrase
                        ? await (0, keystore_1.encryptWithKey)(this.#mainKey, new TextEncoder().encode(seedPassphrase))
                        : null,
                    hdPathTemplate,
                    notBackedUp
                };
                this.#keystoreSeeds.push(newEntry);
                ids.push(newEntry.id);
            }
        }
        catch (error) {
            // Nothing has been persisted yet, so the in-memory seeds are rolled back to
            // keep them in sync with storage
            this.#keystoreSeeds = seedsBeforeAdd;
            throw error;
        }
        await this.#storage.set('keystoreSeeds', this.#keystoreSeeds);
        if (shouldEmitUpdate)
            this.emitUpdate();
        return ids;
    }
    async addSeed(keystoreSeed) {
        await this.withStatus('addSeed', () => this.#addSeeds([keystoreSeed]), true);
    }
    /**
     * Adds the seeds and keys that were queued while the keystore was not ready to store
     * them yet (e.g. accounts synced from another device during onboarding, where the
     * device password is set afterwards).
     *
     * Everything runs sequentially, because internal and external keys are persisted
     * under the same storage key and would otherwise overwrite each other.
     */
    async #addQueuedKeysAndSeeds() {
        const hasQueuedData = !!this.#seedsToAddOnKeystoreReady.length ||
            !!this.#internalKeysToAddOnKeystoreReady.length ||
            !!this.#externalKeysToAddOnKeystoreReady.length;
        if (!hasQueuedData)
            return;
        const seedsToAdd = this.#seedsToAddOnKeystoreReady;
        const internalKeysToAdd = this.#internalKeysToAddOnKeystoreReady;
        const externalKeysToAdd = this.#externalKeysToAddOnKeystoreReady;
        this.#seedsToAddOnKeystoreReady = [];
        this.#internalKeysToAddOnKeystoreReady = [];
        this.#externalKeysToAddOnKeystoreReady = [];
        try {
            // Seeds first, so the keys can keep pointing to the seed they were derived from
            await this.#addSeeds(seedsToAdd, false);
            await this.#addKeys(internalKeysToAdd);
            await this.#addKeysExternallyStored(externalKeysToAdd);
        }
        catch (error) {
            this.emitError({
                level: 'major',
                message: 'Something went wrong when saving your keys. Please try again or contact support if the problem persists.',
                error: error instanceof Error ? error : new Error('keystore: failed to add queued keys')
            });
        }
        finally {
            this.emitUpdate();
        }
    }
    async #updateSeed({ id, label, hdPathTemplate, notBackedUp }) {
        if (!label && !hdPathTemplate && notBackedUp === undefined)
            return;
        const keystoreSeed = this.#keystoreSeeds.find((s) => s.id === id);
        if (!keystoreSeed)
            return;
        if (label)
            keystoreSeed.label = label;
        if (hdPathTemplate)
            keystoreSeed.hdPathTemplate = hdPathTemplate;
        if (notBackedUp !== undefined)
            keystoreSeed.notBackedUp = notBackedUp;
        const updatedKeystoreSeeds = this.#keystoreSeeds.map((s) => s.id === keystoreSeed.id ? keystoreSeed : s);
        this.#keystoreSeeds = updatedKeystoreSeeds;
        await this.#storage.set('keystoreSeeds', this.#keystoreSeeds);
        this.emitUpdate();
    }
    async updateSeed({ id, label, hdPathTemplate, notBackedUp }) {
        await this.withStatus('updateSeed', () => this.#updateSeed({ id, label, hdPathTemplate, notBackedUp }), true);
    }
    /**
     * Called once the user has gone through the reveal + confirm-words backup flow,
     * so the app stops prompting them to back this phrase up.
     */
    async markSeedAsBackedUp(id) {
        await this.updateSeed({ id, notBackedUp: false });
    }
    async deleteSeed(id) {
        await this.withStatus('deleteSeed', () => this.#deleteSeed(id));
    }
    async #deleteSeed(id) {
        await this.initialLoadPromise;
        this.#keystoreSeeds = this.#keystoreSeeds.filter((s) => s.id !== id);
        await this.#storage.set('keystoreSeeds', this.#keystoreSeeds);
        this.emitUpdate();
    }
    async changeTempSeedHdPathTemplateIfNeeded(nextHdPathTemplate) {
        if (!nextHdPathTemplate)
            return; // should never happen
        await this.initialLoadPromise;
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
        await this.initialLoadPromise;
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
        await this.initialLoadPromise;
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
        const newKeys = (await Promise.all(uniqueKeysToAdd.map(async ({ addr, type, label, privateKey, dedicatedToOneSA, meta }) => {
            privateKey = privateKey.substring(0, 2) === '0x' ? privateKey.substring(2) : privateKey;
            // Set up the cipher
            return {
                addr,
                type,
                label,
                dedicatedToOneSA,
                privKey: await (0, keystore_1.encryptWithKey)(this.#mainKey, aes_js_1.default.utils.hex.toBytes(privateKey)),
                meta
            };
        })))
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
        await this.initialLoadPromise;
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
        await this.initialLoadPromise;
        if (this.#mainKey === null)
            throw new Error('keystore: needs to be unlocked');
        const keys = this.#keystoreKeys;
        const storedKey = keys.find((x) => x.addr === keyAddress && x.type === keyType);
        if (!storedKey)
            throw new Error('keystore: key not found');
        if (storedKey.type !== 'internal')
            throw new Error('keystore: key does not have privateKey');
        const decryptedBytes = await (0, keystore_1.decryptWithKey)(this.#mainKey, storedKey.privKey);
        const decryptedPrivateKey = (0, ethers_1.hexlify)(decryptedBytes);
        const wallet = new ethers_1.Wallet(decryptedPrivateKey);
        const keyBackup = await wallet.encrypt(passphrase);
        return JSON.stringify(keyBackup);
    }
    async sendPrivateKeyToUi(keyAddress) {
        const decryptedPrivateKey = await this.#getPrivateKey(keyAddress);
        this.#ui.message.sendUiMessage({ privateKey: `0x${decryptedPrivateKey}` });
    }
    /**
     * Decrypt the private key encrypted with the main key,
     * encrypt it with a new salt and entropy to not leak the
     * main key's ones, and send it over with the salt and entropy
     * to the UI
     */
    async sendPasswordEncryptedPrivateKeyToUi(keyAddress, secret, entropy) {
        const decryptedPrivateKey = await this.#getPrivateKey(keyAddress);
        const entropyGenerator = new entropyGenerator_1.EntropyGenerator();
        const salt = entropyGenerator.generateRandomBytes(32, entropy);
        await (0, wait_1.default)(0); // a trick to prevent UI freeze while the CPU is busy
        const key = await this.#scryptAdapter.scrypt((0, keystore_1.getBytesForSecret)(secret), salt, keystore_1.SCRYPT_PARAMS);
        await (0, wait_1.default)(0);
        const iv = entropyGenerator.generateRandomBytes(16, entropy);
        const derivedKey = key.slice(0, 16);
        const counter = new aes_js_1.default.Counter(iv);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(derivedKey, counter);
        const privateKey = aesCtr.encrypt((0, ethers_1.getBytes)(`0x${decryptedPrivateKey}`));
        this.#ui.message.sendUiMessage({
            privateKey: (0, ethers_1.hexlify)(privateKey),
            salt: (0, ethers_1.hexlify)(salt),
            iv: (0, ethers_1.hexlify)(iv)
        });
    }
    /**
     * Decrypts an imported private key using the provided password (secret, salt, iv),
     * validates the decrypted key against the associated keys,
     * and sends the result to the UI.
     */
    async sendPasswordDecryptedPrivateKeyToUi(secret, key, salt, iv, associatedKeys) {
        await this.initialLoadPromise;
        const counter = new aes_js_1.default.Counter((0, ethers_1.getBytes)(iv));
        const decryptKey = await this.#scryptAdapter.scrypt((0, keystore_1.getBytesForSecret)(secret), (0, ethers_1.getBytes)(salt), keystore_1.SCRYPT_PARAMS);
        const derivedKey = decryptKey.slice(0, 16);
        const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(derivedKey, counter);
        const decryptedBytes = aesCtr.decrypt((0, ethers_1.getBytes)(key));
        const privateKey = `0x${aes_js_1.default.utils.hex.fromBytes(decryptedBytes)}`;
        const addr = (0, ethers_1.computeAddress)(privateKey);
        if (!associatedKeys.includes(addr)) {
            this.errorMessage = 'Incorrect password. Please try again.';
            this.emitUpdate();
            return;
        }
        this.#ui.message.sendUiMessage({ privateKey });
    }
    async sendSeedToUi(id) {
        const decrypted = await this.getSavedSeed(id);
        this.#ui.message.sendUiMessage({
            seed: decrypted.seed,
            seedPassphrase: decrypted.seedPassphrase
        });
    }
    async sendTempSeedToUi() {
        if (!this.#tempSeed)
            return;
        this.#ui.message.sendUiMessage({ tempSeed: this.#tempSeed });
    }
    async #getPrivateKey(keyAddress) {
        await this.initialLoadPromise;
        if (this.#mainKey === null)
            throw new Error('keystore: needs to be unlocked');
        const keys = this.#keystoreKeys;
        const storedKey = keys.find((x) => x.addr === keyAddress && x.type === 'internal');
        if (!storedKey || storedKey.type !== 'internal' || !storedKey.privKey)
            throw new Error('keystore: key not found');
        const decryptedBytes = await (0, keystore_1.decryptWithKey)(this.#mainKey, storedKey.privKey);
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
        const exportedKey = await crypto.subtle.exportKey('raw', this.#mainKey);
        const privateKeyHex = (0, ethers_1.hexlify)(new Uint8Array(exportedKey));
        const privateKey = await (0, eth_crypto_1.decryptWithPrivateKey)(privateKeyHex, encryptedSk);
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
    /**
     * Collects everything another Ambire product needs in order to take over the given
     * keys: the keys themselves and the seeds they were derived from (still encrypted
     * with this device's main key), plus this device's main key wrapped with its password.
     * Nothing gets decrypted here, so this works even when the keystore is locked.
     *
     * `includeSeeds` is what the user chose on the confirmation screen: with it off the
     * keys still travel (so the accounts can sign on the other device), but the recovery
     * phrases they were derived from stay on this device.
     *
     * The main key goes along even when nothing encrypted is exported (hardware wallet keys
     * only, or no keys at all), so the other device always asks for this device's password.
     */
    async exportForSync(keyAddrs, includeSeeds = true) {
        await this.initialLoadPromise;
        const secret = this.#keystoreSecrets.find((s) => s.id === 'password');
        if (!secret)
            throw new EmittableError_1.default({
                level: 'expected',
                message: 'Set a password for this device before syncing your accounts.',
                error: new Error('keystore: no password secret to sync with')
            });
        if (secret.aesEncrypted.cipherType !== keystore_1.CIPHER)
            throw new EmittableError_1.default({
                level: 'major',
                message: 'Something went wrong when preparing your accounts for syncing. Please unlock the app again or contact support if the problem persists.',
                error: new Error('keystore: password secret not migrated to GCM yet')
            });
        const keys = this.#keystoreKeys.filter((key) => keyAddrs.includes(key.addr));
        const seedIds = new Set(keys.map((key) => key.meta?.fromSeedId).filter(Boolean));
        const seeds = includeSeeds ? this.#keystoreSeeds.filter((seed) => seedIds.has(seed.id)) : [];
        // Keys and seeds are migrated to GCM on unlock, so this should never happen. If it
        // does, fail here rather than on the other device, which would reject the payload
        const isEncryptedWithGCM = (payload) => typeof payload !== 'string' && payload?.cipherType === keystore_1.CIPHER;
        const hasNotMigratedPayload = keys.some((key) => key.type === 'internal' && !isEncryptedWithGCM(key.privKey)) ||
            seeds.some((seed) => !isEncryptedWithGCM(seed.seed) ||
                (!!seed.seedPassphrase && !isEncryptedWithGCM(seed.seedPassphrase)));
        if (hasNotMigratedPayload)
            throw new EmittableError_1.default({
                level: 'major',
                message: 'Something went wrong when preparing your accounts for syncing. Please try again.',
                error: new Error('keystore: keys or seeds not migrated to GCM yet')
            });
        return { secret, keys, seeds };
    }
    /**
     * Takes over the keys and seeds exported by another Ambire product. The password of
     * that other device unwraps its main key, which is used only to decrypt the synced
     * data in memory - everything is then re-encrypted with this device's main key.
     *
     * Intentionally not wrapped in `withStatus` and lets errors propagate, because the
     * MainController orchestrates the whole migration (and must not add the accounts if
     * this fails).
     *
     * The password is required even without anything encrypted in the payload (hardware
     * wallet keys only, or no keys at all), as unwrapping the main key is how the user
     * confirms the sync came from their other device.
     */
    async importFromSync(payload, password) {
        await this.initialLoadPromise;
        const { secret, keys, seeds } = payload;
        if (secret.aesEncrypted.cipherType !== keystore_1.CIPHER)
            throw new Error('keystore: synced main key is not encrypted with GCM');
        const secretKey = await (0, keystore_1.deriveSecret)(this.#scryptAdapter, password, secret.scryptParams);
        // The exporting device's main key. Kept in this scope only, never persisted, and only
        // able to decrypt, so its bytes never reach this app.
        const exportedMainKey = await this.#unwrapSyncedMainKey(secretKey, secret.aesEncrypted);
        try {
            // Seeds first, so the keys below can be linked to the seed they were derived from
            const syncedSeedIds = {};
            for (const seed of seeds) {
                const { seed: decryptedSeed, seedPassphrase } = await (0, keystore_1.decryptStoredSeed)(exportedMainKey, seed);
                syncedSeedIds[seed.id] = await this.#storeSyncedSeed({
                    id: seed.id,
                    seed: decryptedSeed,
                    seedPassphrase,
                    hdPathTemplate: seed.hdPathTemplate,
                    notBackedUp: seed.notBackedUp
                });
            }
            const internalKeys = [];
            const externalKeys = [];
            for (const key of keys) {
                if (key.type !== 'internal') {
                    externalKeys.push(key);
                    continue;
                }
                const { fromSeedId, ...restMeta } = key.meta;
                // Drop the reference if the seed didn't come along, so it doesn't dangle
                const syncedFromSeedId = fromSeedId ? syncedSeedIds[fromSeedId] : undefined;
                internalKeys.push({
                    addr: key.addr,
                    type: 'internal',
                    label: key.label,
                    dedicatedToOneSA: key.dedicatedToOneSA,
                    privateKey: (0, ethers_1.hexlify)(await (0, keystore_1.decryptWithKey)(exportedMainKey, key.privKey)),
                    meta: syncedFromSeedId ? { ...restMeta, fromSeedId: syncedFromSeedId } : restMeta
                });
            }
            // Both queue themselves until the keystore is ready to store keys, which is what
            // makes syncing before the device password is set (onboarding) work
            await this.#addKeys(internalKeys);
            await this.#addKeysExternallyStored(externalKeys);
        }
        finally {
            // Everything is re-encrypted with this device's main key by now, so the key derived
            // from the other device's password is of no further use and gets wiped. Its main key
            // itself is a non-extractable handle that goes out of scope with this method, so
            // there are no bytes of it left to wipe
            secretKey.fill(0);
            this.emitUpdate();
        }
    }
    /**
     * Stores a synced seed, or queues it if the device password is not set yet
     * (onboarding). The keystore holds no seeds in that case, so the requested id is
     * guaranteed to be the one the seed ends up stored with.
     */
    async #storeSyncedSeed(seed) {
        if (!this.isReadyToStoreKeys || !this.#mainKey) {
            this.#seedsToAddOnKeystoreReady.push(seed);
            return seed.id;
        }
        const [storedSeedId] = await this.#addSeeds([seed]);
        return storedSeedId;
    }
    async getSigner(keyAddress, keyType) {
        await this.initialLoadPromise;
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
            if (!this.isUnlocked || !this.#mainKey)
                throw new Error('keystore: not unlocked');
            if (storedKey.type !== 'internal' || !storedKey.privKey)
                throw new Error('keystore: key does not have privateKey');
            const decryptedBytes = await (0, keystore_1.decryptWithKey)(this.#mainKey, storedKey.privKey);
            const decryptedPrivateKey = aes_js_1.default.utils.hex.fromBytes(decryptedBytes);
            // @ts-ignore TODO: Figure out the correct type definition
            return new SignerInitializer(key, decryptedPrivateKey);
        }
        // @ts-ignore TODO: Figure out the correct type definition
        return new SignerInitializer(key);
    }
    async getSavedSeed(id) {
        await this.initialLoadPromise;
        if (!this.isUnlocked || !this.#mainKey)
            throw new Error('keystore: not unlocked');
        if (!this.#keystoreSeeds.length)
            throw new Error('keystore: no seed phrase added yet');
        const keystoreSeed = this.#keystoreSeeds.find((s) => s.id === id);
        if (!keystoreSeed)
            throw new Error(`keystore seed with id:${id} not found`);
        const { seed, seedPassphrase } = await (0, keystore_1.decryptStoredSeed)(this.#mainKey, keystoreSeed);
        return { ...keystoreSeed, seed, seedPassphrase };
    }
    /**
     * Derives a recovery phrase's Privacy Pools signing key, so the phrase never reaches
     * `@kohaku-eth/privacy-pools`, whose bundled keystore would keep it.
     *
     * The path check is the security boundary: the SDK chooses the paths, so without it a bug or a
     * malicious bump could get the user's EVM keys. Only `PRIVACY_POOLS_SIGNING_KEY_PATH` passes.
     *
     * Not cached here: each call decrypts the phrase and runs a PBKDF2, so callers keep the key while
     * unlocked - see `createKohakuKeystore`.
     */
    async derivePrivacyPoolsKey(seedId, path) {
        await this.initialLoadPromise;
        if (!this.isUnlocked)
            throw new Error('keystore: not unlocked');
        if (path !== privacyPools_1.PRIVACY_POOLS_SIGNING_KEY_PATH)
            throw new Error(`keystore: refusing to derive a key outside Privacy Pools' paths (${path})`);
        const { seed, seedPassphrase } = await this.getSavedSeed(seedId);
        return ethers_1.HDNodeWallet.fromMnemonic(ethers_1.Mnemonic.fromPhrase(seed, seedPassphrase), path)
            .privateKey;
    }
    async #changeKeystorePassword(newSecret, oldSecret, extraEntropy) {
        await this.initialLoadPromise;
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
    get hasBiometricsSecret() {
        return this.#keystoreSecrets.some((x) => x.id === 'biometrics');
    }
    /**
     * Whether the user must unlock with their password instead of biometrics, because the
     * password secret still awaits its AES-GCM migration. A secret can only be migrated by
     * unlocking with it, so unlocking with biometrics leaves the password secret on the legacy
     * cipher.
     */
    get isPasswordUnlockRequired() {
        if (!this.hasBiometricsSecret)
            return false;
        const passwordSecret = this.#keystoreSecrets.find((x) => x.id === 'password');
        return !!passwordSecret && passwordSecret.aesEncrypted.cipherType !== keystore_1.CIPHER;
    }
    get hasKeystoreTempSeed() {
        return !!this.#tempSeed;
    }
    getAccountKeys(acc) {
        return this.keys.filter((key) => acc.associatedKeys.includes(key.addr));
    }
    getFeePayerKey(accountAddr, paidByKeyAddr, paidByKeyType) {
        const feePayerKeys = this.keys.filter((key) => key.addr === paidByKeyAddr);
        // A private key pays on its own, so it is the default, like it is for signing
        let feePayerKey = feePayerKeys.find((key) => key.type === 'internal') ?? feePayerKeys[0];
        if (paidByKeyType) {
            feePayerKey = feePayerKeys.find((key) => key.type === paidByKeyType) || feePayerKey;
        }
        if (!feePayerKey) {
            const missingKeyAddr = (0, shortenAddress_1.default)(paidByKeyAddr, 13);
            const accAddr = (0, shortenAddress_1.default)(accountAddr, 13);
            return new Error(`Key with address ${missingKeyAddr} for account with address ${accAddr} not found. 'Please try again or contact support if the problem persists.'`);
        }
        return feePayerKey;
    }
    isKeyIteratorInitializedWithTempSeed(keyIterator) {
        if (!this.#tempSeed || !keyIterator || keyIterator.subType !== 'seed')
            return false;
        return (!!keyIterator.isSeedMatching &&
            keyIterator.isSeedMatching(this.#tempSeed.seed, this.#tempSeed.seedPassphrase ?? null));
    }
    async getKeystoreSeed(keyIterator) {
        if (!keyIterator || keyIterator.subType !== 'seed' || !keyIterator.isSeedMatching)
            return null;
        for (const storedSeed of this.#keystoreSeeds) {
            const decryptedStoredSeed = await this.getSavedSeed(storedSeed.id);
            if (!keyIterator.isSeedMatching(decryptedStoredSeed.seed, decryptedStoredSeed.seedPassphrase ?? null))
                continue;
            return storedSeed;
        }
        return null;
    }
    async updateKeystoreKeys() {
        const keystoreKeys = await this.#storage.get('keystoreKeys', []);
        this.#keystoreKeys = keystoreKeys;
        this.emitUpdate();
    }
    decryptMessage = async ({ encryptedMessage, keyAddr, keyType }) => {
        const signer = await this.getSigner(keyAddr, keyType);
        if (!signer.decrypt)
            throw new Error(`This account uses a key type (${keyType}) that does not support getting encryption public key.`);
        try {
            return signer.decrypt(encryptedMessage);
        }
        catch (e) {
            const message = `Failed to decrypt message. Error details: <${e}>`;
            throw new EmittableError_1.default({ message, level: 'major', error: new Error(`keystore: ${e}`) });
        }
    };
    sendDecryptedMessageToUi = async ({ encryptedMessage, keyAddr, keyType }) => {
        const decryptedMessage = await this.decryptMessage({
            encryptedMessage,
            keyAddr,
            keyType
        });
        this.#ui.message.sendUiMessage({ decryptedMessage });
    };
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            // includes the getters in the stringified instance
            isUnlocked: this.isUnlocked,
            keys: this.keys,
            seeds: this.seeds,
            hasPasswordSecret: this.hasPasswordSecret,
            hasBiometricsSecret: this.hasBiometricsSecret,
            isPasswordUnlockRequired: this.isPasswordUnlockRequired,
            hasKeystoreTempSeed: this.hasKeystoreTempSeed,
            hasTempSeed: this.hasTempSeed,
            isReadyToStoreKeys: this.isReadyToStoreKeys
        };
    }
}
exports.KeystoreController = KeystoreController;
//# sourceMappingURL=keystore.js.map