import { JsonRpcProvider } from 'ethers';
/**
 * The used parts of `IEntrypoint.AssetConfig`. Read from the chain, not configured: 0xBow tunes
 * them, and a pool can be replaced behind the same asset.
 */
export type PrivacyPoolsEntrypointAssetConfig = {
    poolAddress: string;
    minimumDepositAmount: bigint;
};
/**
 * Reads an asset's entrypoint configuration. The SDK's `getPoolForAsset` reads it too but does not
 * expose it, and the wallet needs the pool before starting a withdrawal.
 */
export declare const readEntrypointAssetConfig: ({ provider, entrypointAddress, assetAddress }: {
    provider: JsonRpcProvider;
    entrypointAddress: string;
    assetAddress: string;
}) => Promise<PrivacyPoolsEntrypointAssetConfig>;
//# sourceMappingURL=entrypointAssetConfig.d.ts.map