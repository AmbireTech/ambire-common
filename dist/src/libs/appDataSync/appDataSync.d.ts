import { FeatureFlags, UserFeatureFlag } from '../../consts/featureFlags';
import { Account } from '../../interfaces/account';
import { Contacts } from '../../interfaces/addressBook';
import { MainKeyEncryptedWithSecret, StoredKey, StoredKeystoreSeed } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
/**
 * The UR type used to transport the app data sync payload over animated QR codes.
 * Kept from when only accounts were synced, so that older app versions can still read it.
 */
export declare const APP_DATA_SYNC_UR_TYPE = "ambire-account-sync";
/**
 * 2 added the settings, networks and contacts and allowed syncing no accounts at all. An older
 * app rejects it rather than taking the accounts and silently dropping the rest.
 */
export declare const APP_DATA_SYNC_PAYLOAD_VERSION = 2;
/** Accounts and their keys only, which every version of the payload still holds the same way */
declare const ACCOUNTS_ONLY_PAYLOAD_VERSION = 1;
/** Thrown for a payload exported by a newer app, so the user can be told to update this one */
export declare class AppDataSyncNewerVersionError extends Error {
    constructor(version: number);
}
/**
 * Settings that the products share: the privacy opt-outs kept in ambire-common and the
 * ones each app keeps on its own (like the theme), which the app applies itself.
 */
export type AppDataSyncSettings = {
    /** Only the flags the user controls, the rest are internal to each product */
    featureFlags: Partial<Pick<FeatureFlags, UserFeatureFlag>>;
    disabledSwapProviderIds: string[];
    app: {
        [key: string]: string | boolean;
    };
};
/** What else, besides the selected accounts, the user chose to send to the other product */
export type AppDataSyncExportOptions = {
    includeSeeds: boolean;
    /** The app's own settings, present only when the user chose to sync the settings */
    appSettings?: AppDataSyncSettings['app'];
    includeNetworks: boolean;
    includeContacts: boolean;
};
/**
 * Everything needed to move accounts (and the keys controlling them) from one
 * Ambire product to another. Sensitive data travels exactly as it is stored:
 * private keys and seeds stay encrypted with the exporting device's main key,
 * which itself travels wrapped with the exporting device's password (`secret`).
 * The importing device unwraps the main key with that password, decrypts and
 * re-encrypts everything with its own main key.
 */
export type AppDataSyncPayload = {
    v: typeof APP_DATA_SYNC_PAYLOAD_VERSION | typeof ACCOUNTS_ONLY_PAYLOAD_VERSION;
    /**
     * Always present, even with nothing encrypted to sync, because unlocking it is how the
     * importing device confirms the user knows the exporting device's password
     */
    secret: MainKeyEncryptedWithSecret;
    /** Empty when the user synced only the settings, networks or Address Book */
    accounts: Account[];
    keys: StoredKey[];
    seeds: StoredKeystoreSeed[];
    /** Missing when the user did not choose to sync the settings */
    settings?: AppDataSyncSettings;
    /** Missing when the user did not choose to sync the networks */
    networks?: Network[];
    /** The manually added contacts. Missing when the user did not choose to sync them */
    contacts?: Contacts;
};
/**
 * The keys that travel along with the selected accounts. A Safe's owners are accounts
 * of their own, so their keys travel only if the user selected those accounts as well.
 */
export declare const getAppDataSyncKeyAddrs: (accounts: Account[]) => Account["associatedKeys"];
/**
 * Serializes the payload to the hex encoded bytes carried by the animated QR codes.
 * Gzipped first, because JSON full of hex strings compresses 3x or better, and every
 * byte saved is one less QR frame the other device has to catch. Rich JSON, because
 * the networks hold bigints.
 */
export declare const serializeAppDataSyncPayload: (payload: AppDataSyncPayload) => string;
/**
 * Parses and validates the bytes assembled from the scanned animated QR codes.
 * Throws if the payload is incomplete, tampered with or produced by an
 * incompatible (newer) app version.
 */
export declare const parseAppDataSyncPayload: (bytes: Uint8Array) => AppDataSyncPayload;
export {};
//# sourceMappingURL=appDataSync.d.ts.map