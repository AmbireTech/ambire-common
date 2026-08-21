import { getFeeExemptionReason, getFeePercent } from './fee'

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
