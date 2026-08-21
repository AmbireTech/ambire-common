import { getFeePercent } from './fee'

describe('getFeePercent', () => {
  test.each([
    [0, 0.5],
    [500, 0.5],
    [500.01, 0.4],
    [1499.99, 0.4],
    [1500, 0.25],
    [9999.99, 0.25],
    [10000, 0],
    [100000, 0]
  ])('returns the fee for $%s in stkWALLET as %s%%', (stkWalletHeldInUsd, expectedFeePercent) => {
    expect(getFeePercent(stkWalletHeldInUsd)).toBe(expectedFeePercent)
  })

  test.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    'falls back to 0.5%% for an invalid stkWALLET USD value of %s',
    (stkWalletHeldInUsd) => {
      expect(getFeePercent(stkWalletHeldInUsd)).toBe(0.5)
    }
  )
})
