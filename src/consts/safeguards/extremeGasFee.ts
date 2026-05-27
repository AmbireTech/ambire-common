export const EXTREME_GAS_FEE_THRESHOLD_MAINNET_USD = 100
export const EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD = 10
export const EXTREME_GAS_FEE_PROCEED_DELAY_SECONDS = 3

export function getExtremeGasFeeThresholdUsd(chainId: bigint): number {
  return chainId === 1n
    ? EXTREME_GAS_FEE_THRESHOLD_MAINNET_USD
    : EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD
}

export function isExtremeGasFee(feeUsd: number, chainId: bigint): boolean {
  if (!Number.isFinite(feeUsd) || feeUsd <= 0) return false

  return feeUsd > getExtremeGasFeeThresholdUsd(chainId)
}
