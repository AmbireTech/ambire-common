import { describe, expect, test } from '@jest/globals'

import { EXTREME_SWAP_CONFIRMATION_PHRASES } from '../../consts/safeguards/extremeSwapLoss'
import {
  getRandomExtremeSwapConfirmationPhrase,
  getSwapEstimatedLossUsd,
  isExtremeSwapLoss,
  normalizeConfirmationPhraseInput
} from './extremeSwapLoss'

describe('extremeSwapLoss safeguards', () => {
  test('should use the worse of quote and slippage losses', () => {
    expect(getSwapEstimatedLossUsd(100, 95, 90)).toBe(10)
    expect(getSwapEstimatedLossUsd(100, 95, 10)).toBe(90)
  })

  test('should detect extreme swap losses above the threshold', () => {
    expect(isExtremeSwapLoss(1_000)).toBe(false)
    expect(isExtremeSwapLoss(10_001)).toBe(true)
  })

  test('should trim and uppercase the confirmation phrase input', () => {
    expect(normalizeConfirmationPhraseInput("  i'll lose money  ")).toBe("I'LL LOSE MONEY")
  })

  test('should eventually pick every configured confirmation phrase', () => {
    const picked = new Set<string>()

    for (let i = 0; i < 100; i++) {
      picked.add(getRandomExtremeSwapConfirmationPhrase())
    }

    expect([...picked].sort()).toEqual([...EXTREME_SWAP_CONFIRMATION_PHRASES].sort())
  })
})
