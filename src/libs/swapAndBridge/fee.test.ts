import { getFeeExemptionReason, getFeePercent } from './fee'

describe('getFeePercent', () => {
  test.each([
    [0, 0.5],
    [32_999.99, 0.5],
    [33_000, 0.4],
    [99_999.99, 0.4],
    [100_000, 0.25],
    [699_999.99, 0.25],
    [700_000, 0],
    [1_000_000, 0]
  ])('returns the fee for %s stkWALLET held as %s%%', (stkWalletHeld, expectedFeePercent) => {
    expect(getFeePercent(stkWalletHeld)).toBe(expectedFeePercent)
  })

  test.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    'falls back to 0.5%% for an invalid stkWALLET amount of %s',
    (stkWalletHeld) => {
      expect(getFeePercent(stkWalletHeld)).toBe(0.5)
    }
  )
})

describe('getFeeExemptionReason', () => {
  test.each([
    [true, false, true, 'wrap-or-unwrap'],
    [false, true, true, 'fee-exempt-token'],
    [false, false, false, 'fee-collection-unavailable'],
    [false, false, true, undefined]
  ])(
    'returns the expected reason for wrap=%s, exemptToken=%s, feeCollection=%s',
    (isWrapOrUnwrap, isFeeExemptToken, isFeeCollectionAvailable, expectedReason) => {
      expect(
        getFeeExemptionReason({
          isWrapOrUnwrap,
          isFeeExemptToken,
          isFeeCollectionAvailable
        })
      ).toBe(expectedReason)
    }
  )

  test('prioritizes the operation-specific reason when multiple exemptions apply', () => {
    expect(
      getFeeExemptionReason({
        isWrapOrUnwrap: true,
        isFeeExemptToken: true,
        isFeeCollectionAvailable: false
      })
    ).toBe('wrap-or-unwrap')
  })
})
