import { networks as predefinedNetworks } from '../../consts/networks';
import { getFeaturesByNetworkProperties, relayerAdditionalNetworks } from '../networks/networks';
export const getShouldMigrateKeystoreSeedsWithoutHdPath = (keystoreSeeds) => !!keystoreSeeds?.length && keystoreSeeds.every((seed) => typeof seed === 'string');
export const getShouldMigrateKeyMetaNullToKeyMetaCreatedAt = (keystoreKeys) => keystoreKeys.some((key) => {
    const internalKeyWithoutMeta = key.type === 'internal' && !key.meta;
    const externalKeyWithoutCreatedAt = key.type !== 'internal' && !('createdAt' in key.meta);
    return internalKeyWithoutMeta || externalKeyWithoutCreatedAt;
});
export const migrateHiddenTokens = (tokenPreferences) => {
    return tokenPreferences
        .filter(({ isHidden }) => isHidden)
        .map(({ address, networkId, isHidden }) => ({
        address,
        networkId,
        isHidden
    }));
};
export const migrateCustomTokens = (tokenPreferences) => {
    return tokenPreferences
        .filter(({ standard }) => !!standard)
        .map(({ address, standard, networkId }) => ({
        address,
        standard,
        networkId
    }));
};
export async function migrateNetworkPreferencesToNetworks(networkPreferences) {
    const predefinedNetworkIds = predefinedNetworks.map((n) => n.id);
    const customNetworkIds = Object.keys(networkPreferences).filter((k) => !predefinedNetworkIds.includes(k));
    const networksToStore = {};
    predefinedNetworks.forEach((n) => {
        networksToStore[n.id] = n;
    });
    customNetworkIds.forEach((networkId) => {
        const preference = networkPreferences[networkId];
        if (!preference)
            return;
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
            features: getFeaturesByNetworkProperties(networkInfo, undefined),
            hasRelayer: !!relayerAdditionalNetworks.find((net) => net.chainId === preference.chainId),
            predefined: false
        };
    });
    return networksToStore;
}
//# sourceMappingURL=storage.js.map