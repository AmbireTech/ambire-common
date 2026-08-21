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

export type FeeExemptionReason =
  | 'wrap-or-unwrap'
  | 'fee-exempt-token'
  | 'fee-collection-unavailable'

/** Returns why an operation is exempt from the Swap & Bridge fee, when applicable. */
export const getFeeExemptionReason = ({
  isWrapOrUnwrap,
  isFeeExemptToken,
  isFeeCollectionAvailable = true
}: {
  isWrapOrUnwrap: boolean
  isFeeExemptToken: boolean
  isFeeCollectionAvailable?: boolean
}): FeeExemptionReason | undefined => {
  if (isWrapOrUnwrap) return 'wrap-or-unwrap'
  if (isFeeExemptToken) return 'fee-exempt-token'
  if (!isFeeCollectionAvailable) return 'fee-collection-unavailable'

  return undefined
}
