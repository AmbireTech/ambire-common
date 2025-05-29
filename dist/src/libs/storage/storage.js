"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateCustomTokens = exports.migrateHiddenTokens = exports.needsCashbackStatusMigration = exports.getShouldMigrateKeyMetaNullToKeyMetaCreatedAt = exports.getShouldMigrateKeystoreSeedsWithoutHdPath = void 0;
exports.migrateNetworkPreferencesToNetworks = migrateNetworkPreferencesToNetworks;
const networks_1 = require("../../consts/networks");
const networks_2 = require("../networks/networks");
const getShouldMigrateKeystoreSeedsWithoutHdPath = (keystoreSeeds) => 
// @ts-ignore TS complains, but we know that keystoreSeeds is either an array of strings or an array of objects
!!keystoreSeeds?.length && keystoreSeeds.every((seed) => typeof seed === 'string');
exports.getShouldMigrateKeystoreSeedsWithoutHdPath = getShouldMigrateKeystoreSeedsWithoutHdPath;
const getShouldMigrateKeyMetaNullToKeyMetaCreatedAt = (keystoreKeys) => keystoreKeys.some((key) => {
    const internalKeyWithoutMeta = key.type === 'internal' && !key.meta;
    const externalKeyWithoutCreatedAt = key.type !== 'internal' && !('createdAt' in key.meta);
    return internalKeyWithoutMeta || externalKeyWithoutCreatedAt;
});
exports.getShouldMigrateKeyMetaNullToKeyMetaCreatedAt = getShouldMigrateKeyMetaNullToKeyMetaCreatedAt;
const needsCashbackStatusMigration = (cashbackStatusByAccount) => {
    return Object.values(cashbackStatusByAccount).some((value) => typeof value === 'object' && value !== null && 'cashbackWasZeroAt' in value);
};
exports.needsCashbackStatusMigration = needsCashbackStatusMigration;
const migrateHiddenTokens = (tokenPreferences) => {
    return tokenPreferences
        .filter(({ isHidden }) => isHidden)
        .map(({ address, networkId, isHidden }) => ({
        address,
        networkId,
        isHidden
    }));
};
exports.migrateHiddenTokens = migrateHiddenTokens;
const migrateCustomTokens = (tokenPreferences) => {
    return tokenPreferences
        .filter(({ standard }) => !!standard)
        .map(({ address, standard, networkId }) => ({
        address,
        standard,
        networkId
    }));
};
exports.migrateCustomTokens = migrateCustomTokens;
async function migrateNetworkPreferencesToNetworks(networkPreferences) {
    const predefinedNetworkIds = networks_1.networks.map((n) => n.id);
    const customNetworkIds = Object.keys(networkPreferences).filter((k) => !predefinedNetworkIds.includes(k));
    const networksToStore = {};
    networks_1.networks.forEach((n) => {
        networksToStore[n.id] = n;
    });
    customNetworkIds.forEach((networkId) => {
        const preference = networkPreferences[networkId];
        const networkInfo = {
            chainId: preference.chainId,
            isSAEnabled: preference.isSAEnabled ?? false,
            isOptimistic: preference.isOptimistic ?? false,
            rpcNoStateOverride: preference.rpcNoStateOverride ?? true,
            erc4337: preference.erc4337 ?? {
                enabled: false,
                hasPaymaster: false,
                hasBundlerSupport: false
            },
            areContractsDeployed: preference.areContractsDeployed ?? false,
            feeOptions: { is1559: preference.is1559 ?? false },
            platformId: preference.platformId ?? '',
            nativeAssetId: preference.nativeAssetId ?? '',
            flagged: preference.flagged ?? false,
            hasSingleton: preference.hasSingleton ?? false
        };
        delete preference.is1559;
        networksToStore[networkId] = {
            id: networkId,
            ...preference,
            ...networkInfo,
            features: (0, networks_2.getFeaturesByNetworkProperties)(networkInfo, undefined),
            hasRelayer: !!networks_2.relayerAdditionalNetworks.find((net) => net.chainId === preference.chainId),
            predefined: false
        };
    });
    return networksToStore;
}
//# sourceMappingURL=storage.js.map