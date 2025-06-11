import { Encrypted } from 'eth-crypto';
import { HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation';
import { Account } from '../../interfaces/account';
import { KeyIterator } from '../../interfaces/keyIterator';
import { ExternalKey, Key, KeyPreferences, KeystoreSeed, KeystoreSignerInterface, KeystoreSignerType, ReadyToAddKeys } from '../../interfaces/keystore';
import { Platform } from '../../interfaces/platform';
import { WindowManager } from '../../interfaces/window';
import { AccountOp } from '../../libs/accountOp/accountOp';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { StorageController } from '../storage/storage';
declare const STATUS_WRAPPED_METHODS: {
    readonly unlockWithSecret: "INITIAL";
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
export declare class KeystoreController extends EventEmitter {
    #private;
    keyStoreUid: string | null;
    errorMessage: string;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor(platform: Platform, _storage: StorageController, _keystoreSigners: Partial<{
        [key in Key['type']]: KeystoreSignerType;
    }>, windowManager: WindowManager);
    lock(): void;
    get isUnlocked(): boolean;
    get hasTempSeed(): boolean;
    get isReadyToStoreKeys(): boolean;
    set isReadyToStoreKeys(val: boolean);
    getKeyStoreUid(): Promise<string>;
    unlockWithSecret(secretId: string, secret: string): Promise<void>;
    addSecret(secretId: string, secret: string, extraEntropy: string, leaveUnlocked: boolean): Promise<void>;
    removeSecret(secretId: string): Promise<void>;
    get keys(): Key[];
    get seeds(): {
        id: string;
        label: string;
        hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
        withPassphrase: boolean;
    }[];
    addTempSeed({ seed, seedPassphrase, hdPathTemplate }: Omit<KeystoreSeed, 'id' | 'label'>): Promise<void>;
    deleteTempSeed(shouldUpdate?: boolean): void;
    persistTempSeed(): Promise<void>;
    addSeed(keystoreSeed: Omit<KeystoreSeed, 'id' | 'label'>): Promise<void>;
    updateSeed({ id, label, hdPathTemplate }: {
        id: KeystoreSeed['id'];
        label?: KeystoreSeed['label'];
        hdPathTemplate?: KeystoreSeed['hdPathTemplate'];
    }): Promise<void>;
    deleteSeed(id: KeystoreSeed['id']): Promise<void>;
    changeTempSeedHdPathTemplateIfNeeded(nextHdPathTemplate?: HD_PATH_TEMPLATE_TYPE): Promise<void>;
    addKeysExternallyStored(keysToAdd: ExternalKey[]): Promise<void>;
    addKeys(keysToAdd: ReadyToAddKeys['internal']): Promise<void>;
    removeKey(addr: Key['addr'], type: Key['type']): Promise<void>;
    exportKeyWithPasscode(keyAddress: Key['addr'], keyType: Key['type'], passphrase: string): Promise<string>;
    sendPrivateKeyToUi(keyAddress: string): Promise<void>;
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
    getSigner(keyAddress: Key['addr'], keyType: Key['type']): Promise<KeystoreSignerInterface>;
    getSavedSeed(id: string): Promise<KeystoreSeed>;
    changeKeystorePassword(newSecret: string, oldSecret?: string, extraEntropy?: string): Promise<void>;
    updateKeyPreferences(keys: {
        addr: Key['addr'];
        type: Key['type'];
        preferences: KeyPreferences;
    }[]): Promise<void>;
    resetErrorState(): void;
    get hasPasswordSecret(): boolean;
    get hasKeystoreTempSeed(): boolean;
    getAccountKeys(acc: Account): Key[];
    getFeePayerKey(op: AccountOp): Key | Error;
    isKeyIteratorInitializedWithTempSeed(keyIterator?: KeyIterator | null): boolean;
    getKeystoreSeed(keyIterator?: KeyIterator | null): Promise<KeystoreSeed | null>;
    updateKeystoreKeys(): Promise<void>;
    toJSON(): this & {
        isUnlocked: boolean;
        keys: Key[];
        seeds: {
            id: string;
            label: string;
            hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
            withPassphrase: boolean;
        }[];
        hasPasswordSecret: boolean;
        hasKeystoreTempSeed: boolean;
        hasTempSeed: boolean;
        isReadyToStoreKeys: boolean;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=keystore.d.ts.map