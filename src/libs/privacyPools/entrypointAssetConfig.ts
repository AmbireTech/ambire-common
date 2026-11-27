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
  /** The largest share of a withdrawal the entrypoint lets a relayer keep, in basis points. */
  maxRelayFeeBPS: bigint
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
    vettingFeeBPS: BigInt(decoded.vettingFeeBPS),
    maxRelayFeeBPS: BigInt(decoded.maxRelayFeeBPS)
  }
}

const POOL_INTERFACE = new Interface(['function SCOPE() view returns (uint256)'])

/**
 * Reads a pool's scope, which a relayed withdrawal names its pool by: the entrypoint looks the pool
 * up from it.
 */
export const readPrivacyPoolsPoolScope = async ({
  provider,
  poolAddress
}: {
  provider: JsonRpcProvider
  poolAddress: string
}): Promise<bigint> => {
  const data = await provider.call({
    to: poolAddress,
    data: POOL_INTERFACE.encodeFunctionData('SCOPE')
  })
  const [scope] = POOL_INTERFACE.decodeFunctionResult('SCOPE', data)

  return BigInt(scope)
}

/**
 * What to deposit so that `poolValue` goes into the pool after the vetting fee. Rounds down the
 * same way as the 0xBow website's `calculateInitialDeposit`, so the same typed amount becomes the
 * same note in both apps.
 */
export const getDepositAmountWithVettingFee = (poolValue: bigint, vettingFeeBPS: bigint): bigint =>
  (poolValue * BASIS_POINTS_DENOMINATOR) / (BASIS_POINTS_DENOMINATOR - vettingFeeBPS)

/**
 * The most a deposit paid from `balance` can put into the pool. Rounds as the 0xBow website's Max
 * does, so `getDepositAmountWithVettingFee` of it never asks for more than `balance`.
 */
export const getMaxDepositPoolValue = (balance: bigint, vettingFeeBPS: bigint): bigint =>
  (balance * (BASIS_POINTS_DENOMINATOR - vettingFeeBPS)) / BASIS_POINTS_DENOMINATOR
