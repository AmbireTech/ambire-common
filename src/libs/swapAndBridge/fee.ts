import { formatUnits } from 'ethers'

import { getTokenAmount } from '../portfolio/helpers'

import type { TokenResult } from '../portfolio'

/**
 * The Swap & Bridge fee tiers, ordered by the minimum amount of stkWALLET held required to
 * unlock them. Shared between the fee calculation below and the UI (fee tier table, slider
 * threshold marks), so the two never drift apart.
 */
export const SWAP_AND_BRIDGE_FEE_TIERS = [
  { minStkWalletHeld: 0, feePercent: 0.5 },
  { minStkWalletHeld: 33_000, feePercent: 0.4 },
  { minStkWalletHeld: 100_000, feePercent: 0.25 },
  { minStkWalletHeld: 700_000, feePercent: 0 }
] as const

/**
 * The stkWALLET amounts at which the Swap & Bridge fee drops to the next tier, e.g. for marking
 * the corresponding thresholds on the WALLET staking amount slider.
 */
export const SWAP_AND_BRIDGE_FEE_THRESHOLDS = SWAP_AND_BRIDGE_FEE_TIERS.slice(1).map(
  (tier) => tier.minStkWalletHeld
)

/** Returns the Swap & Bridge fee percentage based on the amount of stkWALLET held. */
export const getFeePercent = (stkWalletHeld?: number): number => {
  const normalizedStkWalletHeld =
    typeof stkWalletHeld === 'number' && Number.isFinite(stkWalletHeld) ? stkWalletHeld : 0

  return SWAP_AND_BRIDGE_FEE_TIERS.reduce<number>(
    (feePercent, tier) =>
      normalizedStkWalletHeld >= tier.minStkWalletHeld ? tier.feePercent : feePercent,
    SWAP_AND_BRIDGE_FEE_TIERS[0].feePercent
  )
}

/**
 * Returns the 1-based Swap & Bridge fee tier index (e.g. 2 out of SWAP_AND_BRIDGE_FEE_TIERS.length)
 * for the amount of stkWALLET held, for display purposes (e.g. "tier 2 of 4").
 */
export const getFeeTier = (stkWalletHeld?: number): number => {
  const normalizedStkWalletHeld =
    typeof stkWalletHeld === 'number' && Number.isFinite(stkWalletHeld) ? stkWalletHeld : 0

  return SWAP_AND_BRIDGE_FEE_TIERS.reduce<number>(
    (tierIndex, tier, index) =>
      normalizedStkWalletHeld >= tier.minStkWalletHeld ? index + 1 : tierIndex,
    1
  )
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
