/* eslint-disable import/no-extraneous-dependencies */
import { AMBIRE_ACCOUNT_FACTORY, OPTIMISTIC_ORACLE, SINGLETON } from '../../consts/deploy';
import { networks as predefinedNetworks } from '../../consts/networks';
import { Bundler } from '../../services/bundlers/bundler';
import { getRpcProvider } from '../../services/provider';
import { getSASupport } from '../deployless/simulateDeployCall';
// bnb, gnosis, fantom, metis
export const relayerAdditionalNetworks = [
    {
        chainId: 56n,
        name: 'binance-smart-chain'
    },
    {
        chainId: 100n,
        name: 'gnosis'
    },
    {
        chainId: 250n,
        name: 'fantom'
    },
    {
        chainId: 1088n,
        name: 'andromeda'
    }
];
// 4337 network support
// if it is supported on the network (hasBundlerSupport),
// we check if the user has specifically enabled it through settings (force4337)
// if he has not, we check if the network is predefinedNetwork and we
// have specifically disabled 4337
// finally, we fallback to the bundler support
export function is4337Enabled(hasBundlerSupport, network, force4337) {
    if (!hasBundlerSupport)
        return false;
    // the user has chosen to use 4337
    if (force4337 !== undefined)
        return force4337;
    // if we have set it specifically
    if (network && network.predefined)
        return network.erc4337.enabled;
    // this will be true in this case
    return hasBundlerSupport;
}
export const getNetworksWithFailedRPC = ({ providers }) => {
    return Object.keys(providers).filter((networkId) => typeof providers[networkId].isWorking === 'boolean' && !providers[networkId].isWorking);
};
async function retryRequest(init, counter = 0) {
    if (counter >= 2) {
        throw new Error('flagged');
    }
    const promise = init();
    const result = await promise.catch(async () => {
        const retryRes = await retryRequest(init, counter + 1);
        return retryRes;
    });
    return result;
}
export async function getNetworkInfo(fetch, rpcUrl, chainId, callback, optionalArgs) {
    let networkInfo = {
        force4337: optionalArgs?.force4337,
        chainId,
        isSAEnabled: 'LOADING',
        hasSingleton: 'LOADING',
        isOptimistic: 'LOADING',
        rpcNoStateOverride: 'LOADING',
        erc4337: 'LOADING',
        areContractsDeployed: 'LOADING',
        feeOptions: 'LOADING',
        platformId: 'LOADING',
        nativeAssetId: 'LOADING',
        flagged: 'LOADING'
    };
    callback(networkInfo);
    const timeout = (time = 30000) => {
        return new Promise((resolve) => {
            setTimeout(resolve, time, 'timeout reached');
        });
    };
    let flagged = false;
    const provider = getRpcProvider([rpcUrl], chainId);
    const raiseFlagged = (e, returnData) => {
        if (e.message === 'flagged') {
            flagged = true;
        }
        return returnData;
    };
    const info = await Promise.race([
        Promise.all([
            (async () => {
                const responses = await Promise.all([
                    retryRequest(() => provider.getCode(SINGLETON)),
                    retryRequest(() => provider.getCode(AMBIRE_ACCOUNT_FACTORY)),
                    retryRequest(() => getSASupport(provider)),
                    Bundler.isNetworkSupported(fetch, chainId).catch(() => false)
                    // retryRequest(() => provider.getCode(ERC_4337_ENTRYPOINT)),
                ]).catch((e) => raiseFlagged(e, ['0x', '0x', { addressMatches: false, supportsStateOverride: false }]));
                const [singletonCode, factoryCode, saSupport, hasBundlerSupport] = responses;
                const areContractsDeployed = factoryCode !== '0x';
                // const has4337 = entryPointCode !== '0x' && hasBundler
                const predefinedNetwork = predefinedNetworks.find((net) => net.chainId === chainId);
                // Ambire support is as follows:
                // - either the addresses match after simulation, that's perfect
                // - or we can't do the simulation with this RPC but we have the factory
                // deployed on the network
                const supportsAmbire = saSupport.addressMatches || (!saSupport.supportsStateOverride && areContractsDeployed);
                networkInfo = {
                    ...networkInfo,
                    hasSingleton: singletonCode !== '0x',
                    isSAEnabled: supportsAmbire && singletonCode !== '0x',
                    areContractsDeployed,
                    rpcNoStateOverride: predefinedNetwork && predefinedNetwork.rpcNoStateOverride === true
                        ? true
                        : !saSupport.supportsStateOverride,
                    erc4337: {
                        enabled: is4337Enabled(hasBundlerSupport, predefinedNetwork, optionalArgs?.force4337),
                        hasPaymaster: predefinedNetwork ? predefinedNetwork.erc4337.hasPaymaster : false,
                        hasBundlerSupport
                    }
                };
                callback(networkInfo);
            })(),
            (async () => {
                const oracleCode = await retryRequest(() => provider.getCode(OPTIMISTIC_ORACLE)).catch((e) => raiseFlagged(e, '0x'));
                const isOptimistic = oracleCode !== '0x';
                networkInfo = { ...networkInfo, isOptimistic };
                callback(networkInfo);
            })(),
            (async () => {
                const block = await retryRequest(() => provider.getBlock('latest')).catch((e) => raiseFlagged(e, null));
                const feeOptions = { is1559: block?.baseFeePerGas !== null };
                networkInfo = { ...networkInfo, feeOptions };
                callback(networkInfo);
            })(),
            (async () => {
                const coingeckoRequest = await fetch(`https://cena.ambire.com/api/v3/platform/${Number(chainId)}`).catch(() => ({
                    error: 'currently, we cannot fetch the coingecko information'
                }));
                // set the coingecko info
                let platformId = null;
                let nativeAssetId = null;
                if (!('error' in coingeckoRequest)) {
                    const coingeckoInfo = await coingeckoRequest.json();
                    if (!coingeckoInfo.error) {
                        platformId = coingeckoInfo.platformId;
                        nativeAssetId = coingeckoInfo.nativeAssetId;
                    }
                }
                networkInfo = { ...networkInfo, platformId, nativeAssetId };
                callback(networkInfo);
            })()
        ]),
        timeout()
    ]);
    networkInfo = { ...networkInfo, flagged: flagged || info === 'timeout reached' };
    callback(networkInfo);
    provider.destroy();
}
// call this if you have the network props already calculated
export function getFeaturesByNetworkProperties(networkInfo) {
    const features = [
        {
            id: 'saSupport',
            title: 'Ambire Smart Accounts',
            level: 'loading'
        },
        {
            id: 'simulation',
            title: 'Transaction simulation',
            level: 'loading'
        },
        {
            id: 'prices',
            title: 'Token prices',
            level: 'loading'
        }
    ];
    if (!networkInfo)
        return features.map((f) => ({ ...f, level: 'initial' }));
    const { flagged, isSAEnabled, areContractsDeployed, erc4337, rpcNoStateOverride, nativeAssetId, chainId, hasSingleton, force4337 } = networkInfo;
    const updateFeature = (id, update) => {
        const foundFeature = features.find((f) => f.id === id);
        if (foundFeature) {
            Object.assign(foundFeature, update);
        }
    };
    if (flagged && flagged !== 'LOADING') {
        return [
            {
                id: 'flagged',
                title: 'RPC error',
                level: 'danger',
                msg: 'We were unable to fetch the network information with the provided RPC. Try choosing a different RPC.'
            }
        ];
    }
    if ([isSAEnabled, areContractsDeployed, erc4337, hasSingleton, force4337].every((p) => p !== 'LOADING')) {
        if (!isSAEnabled) {
            updateFeature('saSupport', {
                level: 'danger',
                title: 'Smart contract wallets are not supported',
                msg: hasSingleton
                    ? 'We were unable to detect Smart Account support on the network with the provided RPC. Try choosing a different RPC.'
                    : 'Unfortunately, this network doesn’t support Smart Accounts. It can be used only with Basic Accounts (EOAs).'
            });
        }
        const predefinedNetSettings = predefinedNetworks.find((net) => net.chainId === chainId);
        const erc4337Settings = {
            enabled: is4337Enabled(erc4337.enabled, predefinedNetSettings, force4337),
            hasPaymaster: predefinedNetSettings
                ? predefinedNetSettings.erc4337.hasPaymaster
                : erc4337.hasPaymaster
        };
        const title = erc4337Settings?.enabled
            ? 'Ambire Smart Accounts via ERC-4337 (Account Abstraction)'
            : 'Ambire Smart Accounts';
        if (isSAEnabled && areContractsDeployed) {
            updateFeature('saSupport', {
                title,
                level: 'success',
                msg: "This network supports Smart Accounts, and Ambire Wallet's smart contracts are deployed."
            });
        }
        else if (isSAEnabled && !areContractsDeployed) {
            updateFeature('saSupport', {
                title,
                level: 'warning',
                msg: "This network supports Smart Accounts, but Ambire Wallet's contracts have not yet been deployed. You can deploy them by using a Basic Account and the Deploy contracts option to unlock the Smart Accounts feature. Otherwise, only Basic Accounts (EOAs) can be used on this network."
            });
        }
    }
    if ([rpcNoStateOverride].every((p) => p !== 'LOADING')) {
        const isPredefinedNetwork = predefinedNetworks.find((net) => net.chainId === chainId);
        if (!rpcNoStateOverride && isPredefinedNetwork) {
            updateFeature('simulation', {
                level: 'success',
                title: 'Transaction simulation is fully supported',
                msg: 'Transaction simulation helps predict the outcome of a transaction and your future account balance before it’s broadcasted to the blockchain, enhancing security.'
            });
        }
        else if (!rpcNoStateOverride) {
            updateFeature('simulation', {
                level: 'warning',
                title: 'Transaction simulation is partially supported',
                msg: 'Transaction simulation, one of our security features that predicts the outcome of a transaction before it is broadcast to the blockchain, is not fully functioning on this chain. The reasons might be network or RPC limitations. Try choosing a different RPC.'
            });
        }
        else {
            updateFeature('simulation', {
                level: 'danger',
                title: 'Transaction simulation is not supported',
                msg: "Transaction simulation helps predict the outcome of a transaction and your future account balance before it’s broadcasted to the blockchain, enhancing security. Unfortunately, this feature isn't available for the current network or RPC. Try choosing a different RPC."
            });
        }
    }
    if (nativeAssetId !== 'LOADING') {
        const hasNativeAssetId = nativeAssetId && nativeAssetId !== '';
        updateFeature('prices', {
            level: hasNativeAssetId ? 'success' : 'danger',
            msg: hasNativeAssetId
                ? 'We pull token price information in real-time using third-party providers.'
                : "Our third-party providers don't support this network yet, so we cannot show token prices."
        });
    }
    return features;
}
// call this if you have only the rpcUrls and chainId
// this method makes an RPC request, calculates the network info and returns the features
export function getFeatures(networkInfo) {
    return getFeaturesByNetworkProperties(networkInfo);
}
// Since v4.24.0, a new Network interface has been introduced,
// that replaces the old NetworkDescriptor, NetworkPreference, and CustomNetwork.
// Previously, only NetworkPreferences were stored, with other network properties
// being calculated in a getter each time the networks were needed.
// Now, all network properties are pre-calculated and stored in a structured format: { [key: NetworkId]: Network } in the storage.
// This function migrates the data from the old NetworkPreferences to the new structure
// to ensure compatibility and prevent breaking the extension after updating to v4.24.0
export async function migrateNetworkPreferencesToNetworks(networkPreferences) {
    const predefinedNetworkIds = predefinedNetworks.map((n) => n.id);
    const customNetworkIds = Object.keys(networkPreferences).filter((k) => !predefinedNetworkIds.includes(k));
    const networksToStore = {};
    predefinedNetworks.forEach((n) => {
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
            features: getFeaturesByNetworkProperties(networkInfo),
            hasRelayer: !!relayerAdditionalNetworks.find((net) => net.chainId === preference.chainId),
            predefined: false
        };
    });
    return networksToStore;
}
// is the user allowed to change the network settings to 4337
export function canForce4337(network) {
    return network && network.allowForce4337;
}
export function hasRelayerSupport(network) {
    return (network.hasRelayer || !!relayerAdditionalNetworks.find((net) => net.chainId === network.chainId));
}
//# sourceMappingURL=networks.js.map