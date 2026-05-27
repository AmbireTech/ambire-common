export const EXTREME_SWAP_LOSS_THRESHOLD_USD = 100_000
export const HIGH_PRICE_IMPACT_PERCENT_THRESHOLD = 5
export const SLIPPAGE_MIN_QUOTE_DIFF_USD = 50

export type SwapAmountWarningSeverity = 'elevated' | 'extreme'

export function getSwapQuoteLossUsd(inputValueInUsd: number, outputValueInUsd: number): number {
  return Math.max(0, inputValueInUsd - outputValueInUsd)
}

export function getSwapSlippageLossUsd(inputValueInUsd: number, minInUsd: number): number {
  return Math.max(0, inputValueInUsd - minInUsd)
}

export function getSwapEstimatedLossUsd(
  inputValueInUsd: number,
  outputValueInUsd: number,
  minInUsd: number
): number {
  return Math.max(
    getSwapQuoteLossUsd(inputValueInUsd, outputValueInUsd),
    getSwapSlippageLossUsd(inputValueInUsd, minInUsd)
  )
}

export function isExtremeSwapLoss(estimatedLossUsd: number): boolean {
  return estimatedLossUsd > EXTREME_SWAP_LOSS_THRESHOLD_USD
}

export function getExtremeSwapConfirmationPhrase(estimatedLossUsd: number): string {
  const lossRounded = Math.floor(estimatedLossUsd)

  return `I understand I will lose over ${lossRounded} dollars on this trade`
}

export function normalizeConfirmationPhraseInput(phrase: string): string {
  return phrase.trim().replace(/\s+/g, ' ')
}
