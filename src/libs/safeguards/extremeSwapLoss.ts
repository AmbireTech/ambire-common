import {
  EXTREME_SWAP_CONFIRMATION_PHRASES,
  EXTREME_SWAP_LOSS_THRESHOLD_USD
} from '../../consts/safeguards/extremeSwapLoss'

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

export function normalizeConfirmationPhraseInput(phrase: string): string {
  return phrase.trim().toUpperCase()
}

/** Picks one of the confirmation phrases the user has to type to confirm an extreme-loss swap. */
export function getRandomExtremeSwapConfirmationPhrase(): string {
  const [firstPhrase] = EXTREME_SWAP_CONFIRMATION_PHRASES
  const index = Math.floor(Math.random() * EXTREME_SWAP_CONFIRMATION_PHRASES.length)

  return EXTREME_SWAP_CONFIRMATION_PHRASES[index] ?? firstPhrase
}
