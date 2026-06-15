import {
  containsDomainLike,
  filterStaticBlacklistedAddrs,
  isBlacklistedAsset,
  prepareBlacklistPatterns
} from './blacklist'

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

  describe('prepareBlacklistPatterns', () => {
    it('treats space-padded patterns as lure words and dedupes their variants', () => {
      const prepared = prepareBlacklistPatterns([' Mint', 'mint ', ' MINT ', ' airdrop '])

      expect([...prepared.wordPatterns].sort()).toEqual(['airdrop', 'mint'])
      expect(prepared.substringPatterns).toEqual([])
    })

    it('treats bare patterns as substring signals (preserves the existing contract)', () => {
      const prepared = prepareBlacklistPatterns(['www.', 'https', 'weth'])

      expect([...prepared.substringPatterns].sort()).toEqual(['https', 'weth', 'www.'])
      expect(prepared.wordPatterns).toEqual([])
    })

    it('drops empty and whitespace-only patterns', () => {
      const prepared = prepareBlacklistPatterns(['', '   ', ' mint '])

      expect(prepared.wordPatterns).toEqual(['mint'])
      expect(prepared.substringPatterns).toEqual([])
    })
  })

  describe('isBlacklistedAsset', () => {
    it('matches a substring pattern in the symbol', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'www.scam',
          name: '',
          patterns: prepareBlacklistPatterns(['www.'])
        })
      ).toBe(true)
    })

    it('matches a URL marker in the name', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'OK',
          name: 'claim at https://scam',
          patterns: prepareBlacklistPatterns(['https'])
        })
      ).toBe(true)
    })

    it('matches a phishing domain in the name only when checkForEmbeddedDomain is set (NFT collections)', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'AIRDROP',
          name: 'Claim your reward at claim-x.xyz',
          patterns: prepareBlacklistPatterns([]),
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
          patterns: prepareBlacklistPatterns([])
        })
      ).toBe(false)
    })

    it('still matches blacklist patterns for tokens even with the domain check off', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'OK',
          name: 'claim at https://scam',
          patterns: prepareBlacklistPatterns(['https'])
        })
      ).toBe(true)
    })

    it('matches a lure word on word boundaries inside a phrase', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'OK',
          name: 'claim your reward now',
          patterns: prepareBlacklistPatterns(['claim ', ' airdrop'])
        })
      ).toBe(true)
    })

    it('matches a lure word bounded by punctuation, not just spaces', () => {
      // Old space-padding missed "AIRDROP:" because no space sits next to the word.
      expect(
        isBlacklistedAsset({
          symbol: 'OK',
          name: 'AIRDROP: claim your tokens',
          patterns: prepareBlacklistPatterns([' airdrop'])
        })
      ).toBe(true)
    })

    it('hides the real-world spam examples (multi-word lure)', () => {
      const patterns = prepareBlacklistPatterns([' airdrop '])

      expect(
        isBlacklistedAsset({ symbol: '', name: 'Collection weETH airdrop by AaveFi', patterns })
      ).toBe(true)
      expect(isBlacklistedAsset({ symbol: '', name: 'ARBITRUM AIRDROP', patterns })).toBe(true)
      expect(isBlacklistedAsset({ symbol: '', name: '$PENDLE AIRDROP', patterns })).toBe(true)
      expect(isBlacklistedAsset({ symbol: '', name: 'SUI AIRDROP', patterns })).toBe(true)
      // not real world, but still worth checking
      expect(isBlacklistedAsset({ symbol: '', name: 'AIRDROP! SUI', patterns })).toBe(true)
      expect(isBlacklistedAsset({ symbol: '', name: 'AIRDROP: SUI', patterns })).toBe(true)
    })

    it('hides an NFT collection that embeds a phishing domain', () => {
      // e.g. "$SHIB Reward: t.me/s/shibpool" / "...t.me/s/claimspepe"
      expect(
        isBlacklistedAsset({
          symbol: '',
          name: '$SHIB Reward: t.me/s/shibpool',
          patterns: prepareBlacklistPatterns([]),
          checkForEmbeddedDomain: true
        })
      ).toBe(true)
    })

    it('does NOT hide a legitimate project whose name embeds a lure word as a suffix', () => {
      // Regression: "mint " used to match inside "papermint ", hiding a real token.
      expect(
        isBlacklistedAsset({
          symbol: 'PMINT',
          name: 'papermint protocol',
          patterns: prepareBlacklistPatterns([' mint', 'mint '])
        })
      ).toBe(false)
    })

    it('does not hide a token whose symbol equals a lure word', () => {
      // A standalone lure word is left visible: a project literally named/symboled
      // "WIN" is not spam; the word only counts inside a multi-word lure.
      expect(
        isBlacklistedAsset({
          symbol: 'WIN',
          name: '',
          patterns: prepareBlacklistPatterns([' win', 'win '])
        })
      ).toBe(false)
    })

    it('does not hide a token whose name is exactly a lure word', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'X',
          name: 'Mint',
          patterns: prepareBlacklistPatterns([' mint', 'mint '])
        })
      ).toBe(false)
    })

    it('does not hide a single-token symbol that embeds a lure across punctuation', () => {
      // Symbols are tickers: with no space, "WIN-AIRDROP" reads as one token and
      // stays visible, even though "airdrop" is a whole word across the hyphen.
      expect(
        isBlacklistedAsset({
          symbol: 'WIN-AIRDROP',
          name: '',
          patterns: prepareBlacklistPatterns([' airdrop '])
        })
      ).toBe(false)
    })

    it('hides a symbol that contains a lure word among spaces', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'CLAIM AIRDROP',
          name: '',
          patterns: prepareBlacklistPatterns([' airdrop '])
        })
      ).toBe(true)
    })

    it('matches a lure word as the first, middle or last word of a name', () => {
      const patterns = prepareBlacklistPatterns([' airdrop '])

      expect(isBlacklistedAsset({ symbol: 'X', name: 'Airdrop for holders', patterns })).toBe(true)
      expect(isBlacklistedAsset({ symbol: 'X', name: 'Free airdrop now', patterns })).toBe(true)
      expect(isBlacklistedAsset({ symbol: 'X', name: 'Holders airdrop', patterns })).toBe(true)
    })

    it('does not hide a token whose name embeds a lure word without a boundary', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'WINNER',
          name: 'Winner',
          patterns: prepareBlacklistPatterns([' win', 'win '])
        })
      ).toBe(false)
    })

    it('does not hide a clean asset', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'USDC',
          name: 'USD Coin',
          patterns: prepareBlacklistPatterns(['https', 'www.'])
        })
      ).toBe(false)
    })

    it('never hides custom (user-added) assets, even when they would match', () => {
      expect(
        isBlacklistedAsset({
          symbol: 'www.scam',
          name: 'Visit uniswap.org',
          isCustom: true,
          patterns: prepareBlacklistPatterns(['www.']),
          checkForEmbeddedDomain: true
        })
      ).toBe(false)
    })
  })
})
