import { EXTREME_SWAP_LOSS_THRESHOLD_USD } from '../../consts/safeguards/extremeSwapLoss'

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
  return phrase.trim()
}
