import { describe, expect, test } from '@jest/globals'

import {
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
    expect(isExtremeSwapLoss(10_000)).toBe(false)
    expect(isExtremeSwapLoss(10_001)).toBe(true)
  })

  test('should trim surrounding whitespace from confirmation phrase input', () => {
    expect(normalizeConfirmationPhraseInput('  hello world  ')).toBe('hello world')
  })
})
