export const EXTREME_SWAP_LOSS_THRESHOLD_USD = 10_000
export const HIGH_PRICE_IMPACT_PERCENT_THRESHOLD = 5
export const SLIPPAGE_MIN_QUOTE_DIFF_USD = 50

// The keyword the user must type to confirm an extreme-loss swap. Kept as a
// short, fixed keyword (not localized) so the confirmation is unambiguous.
export const EXTREME_SWAP_CONFIRMATION_PHRASE = 'CONTINUE'

export type SwapAmountWarningSeverity = 'elevated' | 'extreme'
