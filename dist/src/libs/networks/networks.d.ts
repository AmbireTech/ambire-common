import { Fetch } from '../../interfaces/fetch';
import { Network, NetworkFeature, NetworkId, NetworkInfo, NetworkInfoLoading } from '../../interfaces/network';
import { RPCProviders } from '../../interfaces/provider';
export declare const relayerAdditionalNetworks: {
    chainId: bigint;
    name: string;
}[];
export declare function is4337Enabled(hasBundlerSupport: boolean, network?: Network, force4337?: boolean): boolean;
export declare const getNetworksWithFailedRPC: ({ providers }: {
    providers: RPCProviders;
}) => string[];
export declare function getNetworkInfo(fetch: Fetch, rpcUrl: string, chainId: bigint, callback: (networkInfo: NetworkInfoLoading<NetworkInfo>) => void, optionalArgs?: {
    force4337?: boolean;
}): Promise<void>;
export declare function getFeaturesByNetworkProperties(networkInfo: NetworkInfo | NetworkInfoLoading<NetworkInfo> | undefined): NetworkFeature[];
export declare function getFeatures(networkInfo: NetworkInfoLoading<NetworkInfo> | undefined): NetworkFeature[];
export declare function migrateNetworkPreferencesToNetworks(networkPreferences: {
    [key: NetworkId]: Partial<Network>;
}): Promise<{
    [key: string]: Network;
}>;
export declare function canForce4337(network?: Network): boolean | undefined;
export declare function hasRelayerSupport(network: Network): boolean;
//# sourceMappingURL=networks.d.ts.map