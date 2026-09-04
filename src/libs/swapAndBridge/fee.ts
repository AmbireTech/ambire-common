import { formatUnits } from 'ethers'

import { getTokenAmount } from '../portfolio/helpers'

import type { TokenResult } from '../portfolio'

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

/**
 * Returns the Swap & Bridge fee percentage for a stkWALLET token, based on the confirmed
 * on-chain balance rather than any pending/simulated one - the fee is baked into the swap route
 * that gets signed and broadcast, so it must reflect only stkWALLET the account actually holds
 * right now, not a not-yet-settled balance that could still be reverted (e.g. a pending stake
 * that never confirms). Shared by SwapAndBridgeController and the UI so both stay in sync.
 */
export const getFeePercentForStkWalletToken = (stkWalletToken?: TokenResult): number =>
  getFeePercent(
    stkWalletToken
      ? Number(formatUnits(getTokenAmount(stkWalletToken, true), stkWalletToken.decimals))
      : undefined
  )

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
