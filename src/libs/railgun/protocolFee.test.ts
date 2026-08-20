import {
  RAILGUN_FEE_BPS,
  getRailgunShieldedAmountAfterFee,
  getRailgunShieldFee,
  getRailgunUnshieldAmounts
} from './protocolFee'

describe('railgun protocol fee', () => {
  describe('shield', () => {
    it('takes 0.25% out of the shielded amount', () => {
      const oneEther = 10n ** 18n

      expect(getRailgunShieldFee(oneEther, RAILGUN_FEE_BPS)).toBe(2_500_000_000_000_000n)
      expect(getRailgunShieldedAmountAfterFee(oneEther, RAILGUN_FEE_BPS)).toBe(
        997_500_000_000_000_000n
      )
    })

    it('floors the fee, exactly like the contract - so dust pays nothing', () => {
      // 399 * 25 / 10000 = 0.9975, floored to 0
      expect(getRailgunShieldFee(399n, RAILGUN_FEE_BPS)).toBe(0n)
      expect(getRailgunShieldedAmountAfterFee(399n, RAILGUN_FEE_BPS)).toBe(399n)
      expect(getRailgunShieldFee(400n, RAILGUN_FEE_BPS)).toBe(1n)
    })

    it('charges nothing when the fee is disabled, and never more than the contract cap', () => {
      const amount = 10n ** 18n

      expect(getRailgunShieldFee(amount, 0)).toBe(0n)
      // The contract refuses anything above 50%, so a bad read is clamped there rather than
      // producing a fee larger than the amount.
      expect(getRailgunShieldFee(amount, 9_000)).toBe(amount / 2n)
    })

    it('handles non-positive amounts without throwing', () => {
      expect(getRailgunShieldFee(0n, RAILGUN_FEE_BPS)).toBe(0n)
      expect(getRailgunShieldedAmountAfterFee(-1n, RAILGUN_FEE_BPS)).toBe(0n)
    })
  })

  describe('unshield', () => {
    it('grosses the amount up so the recipient gets what was requested', () => {
      const requested = 10n ** 18n
      const { spentAmount, feeAmount, recipientAmount } = getRailgunUnshieldAmounts(
        requested,
        RAILGUN_FEE_BPS
      )

      expect(spentAmount).toBeGreaterThan(requested)
      expect(recipientAmount).toBe(requested)
      expect(spentAmount - feeAmount).toBe(recipientAmount)
      // ~0.2506% of the requested amount, i.e. 0.25% of the grossed-up one
      expect(feeAmount).toBe(2_506_265_664_160_401n)
    })

    it('never leaves the recipient short by more than the contract rounding', () => {
      const amounts = [1n, 7n, 399n, 400n, 12_345n, 10n ** 6n, 10n ** 18n + 7n]

      amounts.forEach((requested) => {
        const { recipientAmount, spentAmount, feeAmount } = getRailgunUnshieldAmounts(
          requested,
          RAILGUN_FEE_BPS
        )

        expect(recipientAmount).toBeLessThanOrEqual(requested)
        expect(requested - recipientAmount).toBeLessThanOrEqual(1n)
        expect(spentAmount).toBe(recipientAmount + feeAmount)
      })
    })

    it('spends exactly the requested amount when the fee is disabled', () => {
      const requested = 10n ** 18n

      expect(getRailgunUnshieldAmounts(requested, 0)).toEqual({
        spentAmount: requested,
        feeAmount: 0n,
        recipientAmount: requested
      })
    })

    it('handles non-positive amounts without dividing by zero', () => {
      expect(getRailgunUnshieldAmounts(0n, RAILGUN_FEE_BPS)).toEqual({
        spentAmount: 0n,
        feeAmount: 0n,
        recipientAmount: 0n
      })
    })
  })
})
