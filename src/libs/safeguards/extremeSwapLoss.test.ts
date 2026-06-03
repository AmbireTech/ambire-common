import { describe, expect, test } from '@jest/globals'

import {
  getExtremeSwapConfirmationPhrase,
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
    expect(isExtremeSwapLoss(100_000)).toBe(false)
    expect(isExtremeSwapLoss(100_001)).toBe(true)
  })

  test('should build a confirmation phrase from the estimated loss', () => {
    expect(getExtremeSwapConfirmationPhrase(100_250.9)).toBe(
      'I understand I will lose over 100250 dollars on this trade'
    )
  })

  test('should normalize confirmation phrase input', () => {
    expect(normalizeConfirmationPhraseInput('  hello   world  ')).toBe('hello world')
  })
})
