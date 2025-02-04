import { Network } from '../../interfaces/network';
export declare function executeBatchedFetch(network: Network): Promise<void>;
/**
 * Resolves symbol and decimals for tokens or name for nfts.
 */
export declare function resolveAssetInfo(address: string, network: Network, callback: (arg: {
    tokenInfo?: {
        decimals: number;
        symbol: string;
    };
    nftInfo?: {
        name: string;
    };
}) => void): Promise<void>;
//# sourceMappingURL=assetInfo.d.ts.map