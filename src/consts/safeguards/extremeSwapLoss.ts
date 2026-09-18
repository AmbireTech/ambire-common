export const EXTREME_SWAP_LOSS_THRESHOLD_USD = 1_000
export const HIGH_PRICE_IMPACT_PERCENT_THRESHOLD = 5
export const SLIPPAGE_MIN_QUOTE_DIFF_USD = 50

// The phrases the user must type to confirm an extreme-loss swap. One of them is
// picked at random every time the warning shows up, so the confirmation can't be
// typed out of muscle memory.
export const EXTREME_SWAP_CONFIRMATION_PHRASES: [string, ...string[]] = [
  "I'LL LOSE MONEY",
  'BAD IDEA',
  'I CHOOSE CHAOS',
  'THIS WILL HURT'
]

export type SwapAmountWarningSeverity = 'elevated' | 'extreme'
