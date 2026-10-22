import { Interface, JsonRpcProvider } from 'ethers'

/**
 * The used parts of `IEntrypoint.AssetConfig`. Read from the chain, not configured: 0xBow tunes
 * them, and a pool can be replaced behind the same asset.
 */
export type PrivacyPoolsEntrypointAssetConfig = {
  poolAddress: string
  minimumDepositAmount: bigint
}

const ENTRYPOINT_INTERFACE = new Interface([
  'function assetConfig(address asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)'
])

/**
 * Reads an asset's entrypoint configuration. The SDK's `getPoolForAsset` reads it too but does not
 * expose it, and the wallet needs the pool before starting a withdrawal.
 */
export const readEntrypointAssetConfig = async ({
  provider,
  entrypointAddress,
  assetAddress
}: {
  provider: JsonRpcProvider
  entrypointAddress: string
  assetAddress: string
}): Promise<PrivacyPoolsEntrypointAssetConfig> => {
  const data = await provider.call({
    to: entrypointAddress,
    data: ENTRYPOINT_INTERFACE.encodeFunctionData('assetConfig', [assetAddress])
  })
  const decoded = ENTRYPOINT_INTERFACE.decodeFunctionResult('assetConfig', data)

  return {
    poolAddress: decoded.pool,
    minimumDepositAmount: BigInt(decoded.minimumDepositAmount)
  }
}
