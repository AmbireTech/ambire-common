import { Encrypted } from 'eth-crypto';
import { HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation';
import { Account } from '../../interfaces/account';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Hex } from '../../interfaces/hex';
import { KeyIterator } from '../../interfaces/keyIterator';
import { ExternalKey, IKeystoreController, Key, KeyPreferences, KeystoreSeed, KeystoreSignerInterface, KeystoreSignerType, KeystoreTempSeed, ReadyToAddKeys, SigningAuthResult, StoredKeystoreSeed } from '../../interfaces/keystore';
import { Platform } from '../../interfaces/platform';
import { IStorageController } from '../../interfaces/storage';
import { IUiController } from '../../interfaces/ui';
import { AppDataSyncPayload } from '../../libs/appDataSync/appDataSync';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const STATUS_WRAPPED_METHODS: {
    readonly unlockWithSecret: "INITIAL";
    readonly verifySecret: "INITIAL";
    readonly addSecret: "INITIAL";
    readonly addSeed: "INITIAL";
    readonly updateSeed: "INITIAL";
    readonly deleteSeed: "INITIAL";
    readonly removeSecret: "INITIAL";
    readonly addKeys: "INITIAL";
    readonly addKeysExternallyStored: "INITIAL";
    readonly changeKeystorePassword: "INITIAL";
    readonly updateKeyPreferences: "INITIAL";
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
export declare class KeystoreController extends EventEmitter implements IKeystoreController {
    #private;
    /**
     * Whether the stored recovery phrases have been read. False if reading failed, when `seeds` may
     * be wrongly empty, so nothing may be dropped for a phrase missing from it.
     */
    areSeedsLoaded: boolean;
    keyStoreUid: string | null;
    errorMessage: string;
    /**
     * The outcome of the last `verifySecret` call. Unlike a status, it survives until the UI
     * resets it, so a re-authentication prompt can read the result no matter when it re-renders.
     */
    signingAuthResult: SigningAuthResult | null;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    initialLoadPromise?: Promise<void>;
    constructor(platform: Platform, _storage: IStorageController, _keystoreSigners: Partial<{
        [key in Key['type']]: KeystoreSignerType;
    }>, ui: IUiController, eventEmitterRegistry?: IEventEmitterRegistryController);
    lock(): void;
    get isUnlocked(): boolean;
    get hasTempSeed(): boolean;
    get isReadyToStoreKeys(): boolean;
    set isReadyToStoreKeys(val: boolean);
    getKeyStoreUid(): Promise<string>;
    unlockWithSecret(secretId: string, secret: string): Promise<void>;
    /**
     * Re-checks a secret on an already unlocked keystore, so the user can prove their identity before
     * signing. Goes through the unlock path, which is a no-op for the lock state when unlocked.
     */
    verifySecret(secretId: string, secret: string): Promise<void>;
    resetSigningAuthResult(): void;
    addSecret(secretId: string, secret: string, extraEntropy: string, leaveUnlocked: boolean): Promise<void>;
    removeSecret(secretId: string): Promise<void>;
    get keys(): Key[];
    get seeds(): {
        id: string;
        label: string;
        hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
        withPassphrase: boolean;
        notBackedUp: boolean;
    }[];
    addTempSeed({ seed, seedPassphrase, hdPathTemplate, notBackedUp }: KeystoreTempSeed): Promise<void>;
    /**
     * Generates a brand new phrase without revealing it to the user. It is marked as
     * not backed up, so the app can prompt for a backup once the account holds funds.
     * Returns the generated temp seed, so the background can derive accounts from it
     * without the phrase ever reaching the UI.
     */
    generateTempSeed({ extraEntropy }: {
        extraEntropy?: string;
    }): Promise<KeystoreTempSeed>;
    /**
     * Generates and stores a recovery phrase flagged as not backed up, returning its id. For a
     * Privacy Pools-only phrase: unlike `generateTempSeed`, it never touches the temp seed another
     * flow may be holding.
     */
    addGeneratedSeed({ extraEntropy }: {
        extraEntropy?: string;
    }): Promise<string>;
    deleteTempSeed(shouldUpdate?: boolean): void;
    persistTempSeed(): Promise<void>;
    addSeed(keystoreSeed: KeystoreTempSeed): Promise<void>;
    updateSeed({ id, label, hdPathTemplate, notBackedUp }: {
        id: KeystoreSeed['id'];
        label?: KeystoreSeed['label'];
        hdPathTemplate?: KeystoreSeed['hdPathTemplate'];
        notBackedUp?: KeystoreSeed['notBackedUp'];
    }): Promise<void>;
    /**
     * Called once the user has gone through the reveal + confirm-words backup flow,
     * so the app stops prompting them to back this phrase up.
     */
    markSeedAsBackedUp(id: KeystoreSeed['id']): Promise<void>;
    deleteSeed(id: KeystoreSeed['id']): Promise<void>;
    changeTempSeedHdPathTemplateIfNeeded(nextHdPathTemplate?: HD_PATH_TEMPLATE_TYPE): Promise<void>;
    addKeysExternallyStored(keysToAdd: ExternalKey[]): Promise<void>;
    addKeys(keysToAdd: ReadyToAddKeys['internal']): Promise<void>;
    removeKey(addr: Key['addr'], type: Key['type']): Promise<void>;
    exportKeyWithPasscode(keyAddress: Key['addr'], keyType: Key['type'], passphrase: string): Promise<string>;
    sendPrivateKeyToUi(keyAddress: string): Promise<void>;
    /**
     * Decrypt the private key encrypted with the main key,
     * encrypt it with a new salt and entropy to not leak the
     * main key's ones, and send it over with the salt and entropy
     * to the UI
     */
    sendPasswordEncryptedPrivateKeyToUi(keyAddress: string, secret: string, entropy: string): Promise<void>;
    /**
     * Decrypts an imported private key using the provided password (secret, salt, iv),
     * validates the decrypted key against the associated keys,
     * and sends the result to the UI.
     */
    sendPasswordDecryptedPrivateKeyToUi(secret: string, key: string, salt: string, iv: string, associatedKeys: string[]): Promise<void>;
    sendSeedToUi(id: string): Promise<void>;
    sendTempSeedToUi(): Promise<void>;
    /**
     * Export with public key encrypt
     *
     * @param keyAddress string - the address of the key you want to export
     * @param publicKey string - the public key, with which to asymmetrically encrypt it (used for key sync with other device's keystoreId)
     * @returns Encrypted
     */
    exportKeyWithPublicKeyEncryption(keyAddress: string, publicKey: string): Promise<Encrypted>;
    importKeyWithPublicKeyEncryption(encryptedSk: Encrypted, dedicatedToOneSA: boolean): Promise<void>;
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
    exportForSync(keyAddrs: Key['addr'][], includeSeeds?: boolean): Promise<Pick<AppDataSyncPayload, 'secret' | 'keys' | 'seeds'>>;
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
    importFromSync(payload: AppDataSyncPayload, password: string): Promise<void>;
    getSigner(keyAddress: Key['addr'], keyType: Key['type']): Promise<KeystoreSignerInterface>;
    getSavedSeed(id: string): Promise<KeystoreSeed>;
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
    derivePrivacyPoolsKey(seedId: KeystoreSeed['id'], path: string): Promise<Hex>;
    changeKeystorePassword(newSecret: string, oldSecret?: string, extraEntropy?: string): Promise<void>;
    updateKeyPreferences(keys: {
        addr: Key['addr'];
        type: Key['type'];
        preferences: KeyPreferences;
    }[]): Promise<void>;
    resetErrorState(): void;
    get hasPasswordSecret(): boolean;
    get hasBiometricsSecret(): boolean;
    /**
     * Whether the user must unlock with their password instead of biometrics, because the
     * password secret still awaits its AES-GCM migration. A secret can only be migrated by
     * unlocking with it, so unlocking with biometrics leaves the password secret on the legacy
     * cipher.
     */
    get isPasswordUnlockRequired(): boolean;
    get hasKeystoreTempSeed(): boolean;
    getAccountKeys(acc: Account): Key[];
    getFeePayerKey(accountAddr: Account['addr'], paidByKeyAddr: Key['addr'], paidByKeyType?: Key['type']): Key | Error;
    isKeyIteratorInitializedWithTempSeed(keyIterator?: KeyIterator | null): boolean;
    getKeystoreSeed(keyIterator?: KeyIterator | null): Promise<StoredKeystoreSeed | null>;
    updateKeystoreKeys(): Promise<void>;
    decryptMessage: ({ encryptedMessage, keyAddr, keyType }: {
        encryptedMessage: string;
        keyAddr: Key["addr"];
        keyType: Key["type"];
    }) => Promise<string>;
    sendDecryptedMessageToUi: ({ encryptedMessage, keyAddr, keyType }: {
        encryptedMessage: string;
        keyAddr: Key["addr"];
        keyType: Key["type"];
    }) => Promise<void>;
    toJSON(): this & {
        isUnlocked: boolean;
        keys: Key[];
        seeds: {
            id: string;
            label: string;
            hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
            withPassphrase: boolean;
            notBackedUp: boolean;
        }[];
        hasPasswordSecret: boolean;
        hasBiometricsSecret: boolean;
        isPasswordUnlockRequired: boolean;
        hasKeystoreTempSeed: boolean;
        hasTempSeed: boolean;
        isReadyToStoreKeys: boolean;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=keystore.d.ts.map