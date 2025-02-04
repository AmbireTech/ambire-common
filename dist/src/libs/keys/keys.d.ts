import { HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation';
import { Account, AccountId } from '../../interfaces/account';
import { Key, KeystoreSeed, StoredKey } from '../../interfaces/keystore';
export declare const DEFAULT_KEY_LABEL_PATTERN: RegExp;
export declare const getDefaultKeyLabel: (prevKeys: Key[], i: number) => string;
export declare const getExistingKeyLabel: (keys: Key[], addr: string, accountAdderType?: Key['type']) => string | undefined;
export declare const getAccountKeysCount: ({ accountAddr, accounts, keys }: {
    accountAddr: AccountId;
    accounts: Account[];
    keys: Key[];
}) => number;
export declare function migrateKeyPreferencesToKeystoreKeys(keyPreferences: {
    addr: Key['addr'];
    type: Key['type'];
    label: string;
}[], keystoreKeys: StoredKey[]): StoredKey[];
export declare const getShouldMigrateKeyMetaNullToKeyMetaCreatedAt: (keystoreKeys: StoredKey[]) => boolean;
export declare function migrateKeyMetaNullToKeyMetaCreatedAt(keystoreKeys: StoredKey[]): StoredKey[];
export declare const getShouldMigrateKeystoreSeedsWithoutHdPath: (keystoreSeeds: string[] | KeystoreSeed[]) => any;
export declare function migrateKeystoreSeedsWithoutHdPathTemplate(prevKeystoreSeeds: string[]): {
    seed: string;
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
}[];
//# sourceMappingURL=keys.d.ts.map