import {
  ScoredAddressPoisoningMatch,
  getAddressPoisoningMatchCounts,
  pickBetterPoisoningMatch
} from './address-poisoning'

describe('address poisoning helpers', () => {
  describe('getAddressPoisoningMatchCounts', () => {
    const trustedAddress = '0xF0cD725D2195b1D3f4BD038c3786005B793237DB'

    test('should detect various overlap shapes and reject totals below 8', () => {
      expect(
        getAddressPoisoningMatchCounts('0xF0cDaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa37DB', trustedAddress)
      ).toEqual({ matchedPrefixCharsCount: 4, matchedSuffixCharsCount: 4 })

      expect(
        getAddressPoisoningMatchCounts('0xF0cD7bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb237DB', trustedAddress)
      ).toEqual({ matchedPrefixCharsCount: 5, matchedSuffixCharsCount: 5 })

      expect(
        getAddressPoisoningMatchCounts('0xF0cD72ccccccccccccccccccccccccccccc237DB', trustedAddress)
      ).toEqual({ matchedPrefixCharsCount: 6, matchedSuffixCharsCount: 5 })

      expect(
        getAddressPoisoningMatchCounts('0xF0cDdddddddddddddddddddddddddddd793237DB', trustedAddress)
      ).toEqual({ matchedPrefixCharsCount: 4, matchedSuffixCharsCount: 8 })

      expect(
        getAddressPoisoningMatchCounts('0xF0ceeeeeeeeeeeeeeeeeeeeeeeeeeeee793237DB', trustedAddress)
      ).toEqual({ matchedPrefixCharsCount: 3, matchedSuffixCharsCount: 8 })

      expect(
        getAddressPoisoningMatchCounts('0xAb12ffffffffffffffffffffffffffff793237DB', trustedAddress)
      ).toEqual({ matchedPrefixCharsCount: 0, matchedSuffixCharsCount: 8 })

      expect(
        getAddressPoisoningMatchCounts('0xF0caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa37DB', trustedAddress)
      ).toBeNull()

      expect(
        getAddressPoisoningMatchCounts('0xAb12eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeCDef', trustedAddress)
      ).toBeNull()
    })

    test('should return null for invalid addresses', () => {
      expect(getAddressPoisoningMatchCounts('0x1234', trustedAddress)).toBeNull()
      expect(getAddressPoisoningMatchCounts(trustedAddress, 'not-an-address')).toBeNull()
    })

    test('should return null for the same address regardless of case', () => {
      expect(
        getAddressPoisoningMatchCounts(trustedAddress.toLowerCase(), trustedAddress.toUpperCase())
      ).toBeNull()
    })
  })

  describe('pickBetterPoisoningMatch', () => {
    const match = (
      matchedAddress: string,
      matchedPrefixCharsCount: number,
      matchedSuffixCharsCount: number,
      lastInteractedAt: number | null
    ): ScoredAddressPoisoningMatch => ({
      matchedAddress,
      matchedPrefixCharsCount,
      matchedSuffixCharsCount,
      lastInteractedAt
    })

    test('should return candidate when there is no best match yet', () => {
      const candidate = match('0x1000000000000000000000000000000000000001', 4, 4, 100)
      expect(pickBetterPoisoningMatch(null, candidate)).toEqual(candidate)
    })

    test('should prefer higher total matched chars', () => {
      const best = match('0x2000000000000000000000000000000000000002', 4, 4, 200)
      const candidate = match('0x3000000000000000000000000000000000000003', 6, 5, 100)
      expect(pickBetterPoisoningMatch(best, candidate)).toEqual(candidate)
    })

    test('should prefer stronger weakest side when totals are equal', () => {
      const best = match('0x4000000000000000000000000000000000000004', 0, 8, 200)
      const candidate = match('0x5000000000000000000000000000000000000005', 4, 4, 100)
      expect(pickBetterPoisoningMatch(best, candidate)).toEqual(candidate)
    })

    test('should prefer more recent interaction as final tie breaker', () => {
      const best = match('0x6000000000000000000000000000000000000006', 4, 4, 100)
      const candidate = match('0x7000000000000000000000000000000000000007', 4, 4, 200)
      expect(pickBetterPoisoningMatch(best, candidate)).toEqual(candidate)
    })

    test('should keep current best when candidate is weaker or older', () => {
      const best = match('0x8000000000000000000000000000000000000008', 4, 8, 200)
      const weakerCandidate = match('0x9000000000000000000000000000000000000009', 3, 8, 500)
      expect(pickBetterPoisoningMatch(best, weakerCandidate)).toEqual(best)

      const sameStrengthOlderCandidate = match(
        '0xA00000000000000000000000000000000000000A',
        4,
        8,
        100
      )
      expect(pickBetterPoisoningMatch(best, sameStrengthOlderCandidate)).toEqual(best)
    })
  })
})
