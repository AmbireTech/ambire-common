import { containsDomainLike, filterStaticBlacklistedAddrs, isBlacklistedAsset } from './blacklist'

describe('portfolio blacklist', () => {
  it('filters static blacklisted addresses', () => {
    const blacklistedToken = '0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f'
    const allowedToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    expect(filterStaticBlacklistedAddrs([blacklistedToken, allowedToken], 1n)).toEqual([
      allowedToken
    ])
  })

  describe('containsDomainLike', () => {
    it('detects a domain embedded anywhere in the text', () => {
      expect(containsDomainLike('Visit uniswap.org')).toBe(true)
      expect(containsDomainLike('claim-x.xyz reward')).toBe(true)
      expect(containsDomainLike('airdrop at app.uniswap.org')).toBe(true)
      expect(containsDomainLike('go to t.me/scam')).toBe(true)
    })

    it('detects a domain regardless of casing or surrounding punctuation', () => {
      expect(containsDomainLike('UNISWAP.ORG')).toBe(true)
      expect(containsDomainLike('(uniswap.org)')).toBe(true)
      expect(containsDomainLike('claim@uniswap.org')).toBe(true)
    })

    it('does not flag legitimate token names', () => {
      expect(containsDomainLike('USD Coin')).toBe(false)
      expect(containsDomainLike('Wrapped Ether')).toBe(false)
      expect(containsDomainLike('lobsterdao')).toBe(false)
    })

    it('does not flag non-domain dotted strings', () => {
      expect(containsDomainLike('ETH 2.0')).toBe(false)
      expect(containsDomainLike('v2.0')).toBe(false)
      // suffix is not a real ICANN TLD
      expect(containsDomainLike('eth.staking')).toBe(false)
      expect(containsDomainLike('file.tmp')).toBe(false)
    })

    it('handles empty and address-like input', () => {
      expect(containsDomainLike('')).toBe(false)
      expect(containsDomainLike('0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(false)
    })
  })

  describe('isBlacklistedAsset', () => {
    it('matches a blacklist pattern in the symbol', () => {
      expect(
        isBlacklistedAsset({ symbol: 'www.scam', name: '', lowercasedPatterns: ['www.'] })
      ).toBe(true)
    })

    it('matches a blacklist pattern in the name', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'OK',
          name: 'claim at https://scam',
          lowercasedPatterns: ['https']
        })
      ).toBe(true)
    })

    it('matches a phishing domain in the name only when checkForEmbeddedDomain is set (NFT collections)', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'AIRDROP',
          name: 'Claim your reward at claim-x.xyz',
          lowercasedPatterns: [],
          checkForEmbeddedDomain: true
        })
      ).toBe(true)
    })

    it('does not run the embedded-domain check for tokens (checkForEmbeddedDomain off)', () => {
      // A token name that embeds a domain is NOT hidden, because token
      // names/symbols legitimately contain dotted strings (false positives).
      expect(
        isBlacklistedAsset({
          symbol: 'AIRDROP',
          name: 'Claim your reward at claim-x.xyz',
          lowercasedPatterns: []
        })
      ).toBe(false)
    })

    it('still matches blacklist patterns for tokens even with the domain check off', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'OK',
          name: 'claim at https://scam',
          lowercasedPatterns: ['https']
        })
      ).toBe(true)
    })

    it('does not hide a clean asset', () => {
      expect(
        isBlacklistedAsset({ symbol: 'USDC', name: 'USD Coin', lowercasedPatterns: ['https', 'www.'] })
      ).toBe(false)
    })

    it('never hides custom (user-added) assets, even when they would match', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'www.scam',
          name: 'Visit uniswap.org',
          isCustom: true,
          lowercasedPatterns: ['www.'],
          checkForEmbeddedDomain: true
        })
      ).toBe(false)
    })
  })
})
