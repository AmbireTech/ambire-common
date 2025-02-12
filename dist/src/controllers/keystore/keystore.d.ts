import { Encrypted } from 'eth-crypto';
import { HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation';
import { Banner } from '../../interfaces/banner';
import { ExternalKey, Key, KeyPreferences, KeystoreSeed, KeystoreSignerType, ReadyToAddKeys } from '../../interfaces/keystore';
import { Storage } from '../../interfaces/storage';
import { WindowManager } from '../../interfaces/window';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
declare const STATUS_WRAPPED_METHODS: {
    readonly unlockWithSecret: "INITIAL";
    readonly addSecret: "INITIAL";
    readonly addSeed: "INITIAL";
    readonly moveTempSeedToKeystoreSeeds: "INITIAL";
    readonly deleteSavedSeed: "INITIAL";
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
export declare class KeystoreController extends EventEmitter {
    #private;
    keyStoreUid: string | null;
    isReadyToStoreKeys: boolean;
    errorMessage: string;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor(_storage: Storage, _keystoreSigners: Partial<{
        [key in Key['type']]: KeystoreSignerType;
    }>, windowManager: WindowManager);
    lock(): void;
    get isUnlocked(): boolean;
    getKeyStoreUid(): Promise<string>;
    unlockWithSecret(secretId: string, secret: string): Promise<void>;
    addSecret(secretId: string, secret: string, extraEntropy: string, leaveUnlocked: boolean): Promise<void>;
    removeSecret(secretId: string): Promise<void>;
    get keys(): Key[];
    addSeedToTemp({ seed, seedPassphrase, hdPathTemplate }: KeystoreSeed): Promise<void>;
    deleteTempSeed(shouldUpdate?: boolean): void;
    moveTempSeedToKeystoreSeeds(): Promise<void>;
    addSeed(keystoreSeed: KeystoreSeed): Promise<void>;
    changeTempSeedHdPathTemplateIfNeeded(nextHdPathTemplate?: HD_PATH_TEMPLATE_TYPE): Promise<void>;
    changeSavedSeedHdPathTemplateIfNeeded(nextHdPathTemplate?: HD_PATH_TEMPLATE_TYPE): Promise<void>;
    addKeysExternallyStored(keysToAdd: ExternalKey[]): Promise<void>;
    addKeys(keysToAdd: ReadyToAddKeys['internal']): Promise<void>;
    removeKey(addr: Key['addr'], type: Key['type']): Promise<void>;
    exportKeyWithPasscode(keyAddress: Key['addr'], keyType: Key['type'], passphrase: string): Promise<string>;
    sendPrivateKeyToUi(keyAddress: string): Promise<void>;
    sendSeedToUi(): Promise<void>;
    /**
     * Export with public key encrypt
     *
     * @param keyAddress string - the address of the key you want to export
     * @param publicKey string - the public key, with which to asymmetrically encrypt it (used for key sync with other device's keystoreId)
     * @returns Encrypted
     */
    exportKeyWithPublicKeyEncryption(keyAddress: string, publicKey: string): Promise<Encrypted>;
    importKeyWithPublicKeyEncryption(encryptedSk: Encrypted, dedicatedToOneSA: boolean): Promise<void>;
    getSigner(keyAddress: Key['addr'], keyType: Key['type']): Promise<import("../../interfaces/keystore").KeystoreSigner>;
    getSavedSeed(): Promise<KeystoreSeed>;
    changeKeystorePassword(newSecret: string, oldSecret?: string): Promise<void>;
    updateKeyPreferences(keys: {
        addr: Key['addr'];
        type: Key['type'];
        preferences: KeyPreferences;
    }[]): Promise<void>;
    deleteSavedSeed(): Promise<void>;
    resetErrorState(): void;
    get hasPasswordSecret(): boolean;
    get hasKeystoreSavedSeed(): boolean;
    get hasKeystoreTempSeed(): boolean;
    get banners(): Banner[];
    toJSON(): this & {
        isUnlocked: boolean;
        keys: Key[];
        hasPasswordSecret: boolean;
        hasKeystoreSavedSeed: boolean;
        hasKeystoreTempSeed: boolean;
        banners: Banner[];
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=keystore.d.ts.map