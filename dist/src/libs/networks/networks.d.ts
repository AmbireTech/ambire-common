import { Fetch } from '../../interfaces/fetch';
import { Network, NetworkFeature, NetworkInfo, NetworkInfoLoading } from '../../interfaces/network';
import { RPCProviders } from '../../interfaces/provider';
export declare const relayerAdditionalNetworks: {
    chainId: bigint;
    name: string;
}[];
export declare function is4337Enabled(hasBundlerSupport: boolean, network?: Network): boolean;
export declare const getNetworksWithFailedRPC: ({ providers }: {
    providers: RPCProviders;
}) => string[];
/**
 * Fetches detailed network information from an RPC provider.
 * Used when adding a new network, updating network info, or when the RPC provider is changed,
 * And once every 24 hours for custom networks.
 *
 * - Checks smart account (SA) support, singleton contract, and state override capabilities.
 * - Determines if the network supports ERC-4337 and Account Abstraction.
 * - Fetches additional metadata from external sources (e.g., CoinGecko).
 */
export declare function getNetworkInfo(fetch: Fetch, rpcUrl: string, chainId: bigint, callback: (networkInfo: NetworkInfoLoading<NetworkInfo>) => void, network: Network | undefined): Promise<void>;
/**
 * Determines supported features for a network based on its properties.
 *
 * Smart Accounts, ERC-4337, transaction simulation, and price tracking are supported.
 */
export declare function getFeaturesByNetworkProperties(networkInfo: NetworkInfo | NetworkInfoLoading<NetworkInfo> | undefined, network?: Network): NetworkFeature[];
export declare function getFeatures(networkInfo: NetworkInfoLoading<NetworkInfo> | undefined, network: Network | undefined): NetworkFeature[];
export declare function hasRelayerSupport(network: Network): boolean;
//# sourceMappingURL=networks.d.ts.map