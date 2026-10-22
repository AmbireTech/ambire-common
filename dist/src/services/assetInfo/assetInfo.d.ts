import { Network } from '../../interfaces/network';
import { TokenResult } from '../../libs/portfolio';
export declare function executeBatchedFetch(network: Network, isTokenPricesEnabled: () => boolean): Promise<void>;
/**
 * Resolves symbol and decimals for tokens or name for nfts.
 */
export declare function resolveAssetInfo(address: string, network: Network, callback: (arg: {
    tokenInfo?: TokenResult;
    nftInfo?: {
        name: string;
    };
}) => void, isTokenPricesEnabled: () => boolean): Promise<void>;
//# sourceMappingURL=assetInfo.d.ts.map