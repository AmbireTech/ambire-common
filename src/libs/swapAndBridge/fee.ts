/** Returns the Swap & Bridge fee percentage based on the stkWALLET value held in USD. */
export const getFeePercent = (stkWalletHeldInUsd?: number): number => {
  if (
    typeof stkWalletHeldInUsd !== 'number' ||
    !Number.isFinite(stkWalletHeldInUsd) ||
    stkWalletHeldInUsd <= 500
  )
    return 0.5
  if (stkWalletHeldInUsd < 1500) return 0.4
  if (stkWalletHeldInUsd < 10000) return 0.25

  return 0
}
