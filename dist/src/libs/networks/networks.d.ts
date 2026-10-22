import { Account, AccountStates } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { Network, NetworkFeature, NetworkInfo, NetworkInfoLoading, RelayerNetwork, SupportedNetworks } from '../../interfaces/network';
import { RPCProvider, RPCProviders } from '../../interfaces/provider';
export declare const relayerAdditionalNetworks: {
    chainId: bigint;
    name: string;
}[];
export declare function is4337Enabled(hasBundlerSupport: boolean, network?: Network): boolean;
export declare const getNetworksWithFailedRPC: ({ providers }: {
    providers: RPCProviders;
}) => string[];
export declare function getProviderBatchMaxCount(network: Network, rpcUrl: string): number | undefined;
export declare function getStateOverrideSupport(provider: RPCProvider): Promise<boolean>;
/**
 * The network info shape before any RPC probe has resolved. Every field is
 * 'LOADING' except the chain id.
 */
export declare function getLoadingNetworkInfo(chainId: bigint): NetworkInfoLoading<NetworkInfo>;
/**
 * True while any of the probes behind the network info is still running.
 */
export declare function isNetworkInfoPending(info?: NetworkInfoLoading<NetworkInfo>): boolean;
/**
 * Fetches a network's capabilities from an RPC provider - smart account support, ERC-4337,
 * fee options and price metadata.
 *
 * Streams progress through `callback`.
 */
export declare function getNetworkInfo(fetch: Fetch, chainId: bigint, provider: RPCProvider, callback: (networkInfo: NetworkInfoLoading<NetworkInfo>) => void, network: Network | undefined): Promise<void>;
/**
 * Determines supported features for a network based on its properties.
 *
 * Smart Accounts, ERC-4337, transaction simulation, and price tracking are supported.
 */
export declare function getFeaturesByNetworkProperties(networkInfo: NetworkInfo | NetworkInfoLoading<NetworkInfo> | undefined, network?: Network): NetworkFeature[];
/** The feature list to render while a network's info is still being fetched. */
export declare function getLoadingFeatures(): NetworkFeature[];
export declare function getFeatures(networkInfo: NetworkInfoLoading<NetworkInfo> | undefined, network: Network | undefined): NetworkFeature[];
export declare function hasRelayerSupport(network: Network): boolean;
/**
 * Validates a single network object against some of the Network interface requirements.
 */
export declare function sanityCheckImportantNetworkProperties(network: Network): boolean;
/**
 * Validates networks coming from the storage, filtering out the invalid ones.
 * This prevents crashes when networks have missing or invalid mandatory properties.
 */
export declare function getValidNetworks(networksInStorage: {
    [key: string]: Network;
}): {
    [key: string]: Network;
};
/**
 * Updates the currently stored networks with the networks coming from the relayer.
 * To determine which networks to update, it compares the predefinedConfigVersion of the stored network
 * with the relayer network. If no network is found in the storage, it adds the relayer network as a new one.
 * Even if the predefinedConfigVersion is the same or lower, some properties of the stored network should be updated.
 */
export declare const getNetworksUpdatedWithRelayerNetworks: (currentNetworks: {
    [key: string]: Network;
}, relayerNetworks: {
    [key: string]: RelayerNetwork;
}) => {
    mergedNetworks: {
        [key: string]: Network;
    };
    updatedNetworkChainIds: Network["chainId"][];
};
export declare const networkChainIdToHex: (chainId: number | bigint) => string;
export declare const getAccountNetworks: (networks: Network[], accountStates: AccountStates, acc?: Account | null) => Network[];
export declare const getAccountNotSupportedReason: (acc?: Account | null) => "" | "Ambire v1 accounts are not supported on this network" | "Ambire smart accounts are not supported on this network" | "Safe account is not activated on this network";
export declare const getSupportedNetworks: (networks: Network[], accountStates: AccountStates, acc?: Account | null, additionalCheck?: {
    chainIds: bigint[];
    reason: string;
}, allowUndeployedSafeOnChainId?: bigint) => SupportedNetworks[];
//# sourceMappingURL=networks.d.ts.map