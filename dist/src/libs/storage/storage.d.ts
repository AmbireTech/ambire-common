import { KeystoreSeed, StoredKey } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { LegacyTokenPreference } from '../portfolio/customToken';
export declare const getShouldMigrateKeystoreSeedsWithoutHdPath: (keystoreSeeds: string[] | KeystoreSeed[]) => boolean;
export declare const getShouldMigrateKeyMetaNullToKeyMetaCreatedAt: (keystoreKeys: StoredKey[]) => boolean;
export declare const migrateHiddenTokens: (tokenPreferences: LegacyTokenPreference[]) => {
    address: any;
    networkId: any;
    isHidden: any;
}[];
export declare const migrateCustomTokens: (tokenPreferences: LegacyTokenPreference[]) => {
    address: any;
    standard: any;
    networkId: any;
}[];
export declare function migrateNetworkPreferencesToNetworks(networkPreferences: {
    [key: string]: Partial<Network>;
}): Promise<{
    [key: string]: Network;
}>;
//# sourceMappingURL=storage.d.ts.map