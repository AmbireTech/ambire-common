import { Interface, JsonRpcProvider } from 'ethers'

/**
 * The entrypoint's per-asset settings, as `IEntrypoint.AssetConfig` stores them.
 *
 * Read from the chain rather than configured, unlike the asset list in `consts/privacyPools`:
 * these are operator-tunable and 0xBow does tune them per deployment - Sepolia caps the relay fee
 * at 1% while Ethereum allows 10% - and a pool can be replaced behind the same asset.
 */
export type PrivacyPoolsEntrypointAssetConfig = {
  poolAddress: string
  minimumDepositAmount: bigint
  vettingFeeBps: bigint
  /**
   * The largest share of a withdrawal the entrypoint will hand a relayer. Only binds withdrawals
   * sent through `Entrypoint.relay`; paymaster-sponsored ones call the pool directly.
   */
  maxRelayFeeBps: bigint
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
    minimumDepositAmount: BigInt(decoded.minimumDepositAmount),
    vettingFeeBps: BigInt(decoded.vettingFeeBPS),
    maxRelayFeeBps: BigInt(decoded.maxRelayFeeBPS)
  }
}
