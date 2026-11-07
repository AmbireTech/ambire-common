import { Interface, JsonRpcProvider } from 'ethers'

/**
 * The used parts of `IEntrypoint.AssetConfig`. Read from the chain, not configured: 0xBow tunes
 * them, and a pool can be replaced behind the same asset.
 */
export type PrivacyPoolsEntrypointAssetConfig = {
  poolAddress: string
  minimumDepositAmount: bigint
  /** The share of a deposit the entrypoint keeps, in basis points (1 = 0.01%). */
  vettingFeeBPS: bigint
}

const BASIS_POINTS_DENOMINATOR = 10_000n

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
    minimumDepositAmount: BigInt(decoded.minimumDepositAmount),
    vettingFeeBPS: BigInt(decoded.vettingFeeBPS)
  }
}

/**
 * What a deposit of `amount` adds to the pool, after the entrypoint keeps its vetting fee. Rounds
 * the fee down, as the entrypoint does, so it matches the note the deposit becomes.
 */
export const getDepositAmountAfterVettingFee = (amount: bigint, vettingFeeBPS: bigint): bigint =>
  amount - (amount * vettingFeeBPS) / BASIS_POINTS_DENOMINATOR
