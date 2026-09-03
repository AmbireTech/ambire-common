/** Returns the Swap & Bridge fee percentage based on the amount of stkWALLET held. */
export const getFeePercent = (stkWalletHeld?: number): number => {
  if (
    typeof stkWalletHeld !== 'number' ||
    !Number.isFinite(stkWalletHeld) ||
    stkWalletHeld < 33_000
  )
    return 0.5
  if (stkWalletHeld < 100_000) return 0.4
  if (stkWalletHeld < 700_000) return 0.25

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
