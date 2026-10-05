import { Interface, JsonRpcProvider } from 'ethers'

/**
 * The parts of the entrypoint's per-asset settings (`IEntrypoint.AssetConfig`) the wallet uses.
 *
 * Read from the chain rather than configured, unlike the asset list in `consts/privacyPools`:
 * 0xBow tunes them, and a pool can be replaced behind the same asset.
 */
export type PrivacyPoolsEntrypointAssetConfig = {
  poolAddress: string
  minimumDepositAmount: bigint
}

const ENTRYPOINT_INTERFACE = new Interface([
  'function assetConfig(address asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)'
])

/**
 * Reads an asset's entrypoint configuration.
 *
 * The SDK fetches the same tuple in `getPoolForAsset` but keeps it to itself, so the wallet reads
 * it separately - to learn which pool an asset's withdrawal goes through before any work is done
 * on it.
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
