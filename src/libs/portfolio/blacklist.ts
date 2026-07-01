import { parse } from 'tldts'

import type { TokenBlacklist } from './interfaces'

/**
 * Static list of tokens to exclude from display, keyed by chainId.
 * Addresses MUST BE CHECKSUMMED.
 * Symbol patterns are matched case-insensitively as substrings.
 */
export const STATIC_BLACKLIST: Omit<TokenBlacklist, 'updatedAt'> = {
  blacklistAddrs: {
    // Gnosis Chain (xDAI)
    '100': [
      '0xcB444e90D8198415266c6a2724b7900fb12FC56E' // EURe - Duplicate
    ],
    // Polygon
    '137': [
      '0x18ec0A6E18E5bc3784fDd3a3634b31245ab704F6', // EURe (Monerium EUR emoney) - Excluded due to regulatory restrictions and limited utility in the app
      '0x0B91B07bEb67333225A5bA0259D55AeE10E3A578' // MNEP - scam token
    ],
    // Ethereum Mainnet
    '1': [
      '0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f' // EURe - Duplicate
    ],
    // Hyper EVM
    '999': [
      '0x94e8396e0869c9F2200760aF0621aFd240E1CF38' // wstHYPE - Excluded because it's a duplicate of stHYPE
    ],
    // Andromeda
    '1088': [
      '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000' // METIS as an ERC-20 token - Excluded because it's a duplicate of the native token
    ],
    // Optimism
    '10': [
      '0xDfA2d3a0d32F870D87f8A0d7AA6b9CdEB7bc5AdB' // sUSD - Duplicate of 0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9
    ]
  },
  blacklistBySymbols: ['https', 'www.']
}

export const filterStaticBlacklistedAddrs = (tokenAddrs: string[], chainId: bigint) => {
  const staticBlacklistedAddrs = STATIC_BLACKLIST.blacklistAddrs[chainId.toString()] || []
  if (!staticBlacklistedAddrs.length) return tokenAddrs

  const staticBlacklistedAddrsLower = new Set(
    staticBlacklistedAddrs.map((addr) => addr.toLowerCase())
  )

  return tokenAddrs.filter((addr) => !staticBlacklistedAddrsLower.has(addr.toLowerCase()))
}

const isDomainChar = (char: string): boolean =>
  (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '.' || char === '-'

/**
 * Detects a real registrable domain anywhere in the text (e.g. "uniswap.org",
 * "claim-x.xyz"). Spam assets embed phishing domains in their name/symbol to
 * impersonate real projects, often without an "https"/"www." prefix.
 *
 * We scan the text into domain-charset candidates (no regex, per repo rule) and
 * validate each against the Public Suffix List via tldts. The `isIcann` check
 * rejects non-domain dotted strings such as "v2.0" or "eth.staking".
 */
export const containsDomainLike = (text: string): boolean => {
  // A domain needs a dot; skip the scan entirely for the common dot-free case
  if (!text.includes('.')) return false

  const lower = text.toLowerCase()
  let candidate = ''
  let candidateHasDot = false

  // Iterate one past the end so the final candidate is flushed too
  for (let i = 0; i <= lower.length; i++) {
    const char = lower[i]
    if (char && isDomainChar(char)) {
      candidate += char
      if (char === '.') candidateHasDot = true
      continue
    }

    // Only dotted candidates can be domains, so parse just those
    if (candidateHasDot && parse(candidate).isIcann === true) return true
    candidate = ''
    candidateHasDot = false
  }

  return false
}

const isWordChar = (char: string | undefined): boolean =>
  !!char && ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9'))

/**
 * Splits text into its word tokens — maximal runs of [a-z0-9] — so a lure word
 * can be matched as a WHOLE word rather than a substring. No regex, per repo
 * rule, mirroring the char scan in `containsDomainLike`.
 *
 * "free mint!" → ["free", "mint"], so the lure "mint" matches "free mint" but
 * never the legitimate "papermint". Text is assumed lowercased by the caller.
 */
const toWords = (text: string): string[] => {
  const words: string[] = []
  let current = ''
  for (const char of text) {
    if (isWordChar(char)) {
      current += char
    } else if (current) {
      words.push(current)
      current = ''
    }
  }
  if (current) words.push(current)

  return words
}

// A space (incl. non-breaking) marks a word break; punctuation does not, so a
// single-token symbol like "WIN", "WETH" or "WIN-AIRDROP" is not multi-word.
const isMultiWord = (text: string): boolean => text.includes(' ') || text.includes('\u00a0')

export interface PreparedBlacklistPatterns {
  // Lure words (e.g. "airdrop", "mint"), matched on word boundaries.
  wordPatterns: string[]
  // Raw substring signals (e.g. "https", "www.", a full symbol/name), matched anywhere.
  substringPatterns: string[]
}

/**
 * Normalizes raw blacklist patterns once, so per-asset matching stays cheap.
 *
 * Classification keys off the surrounding whitespace the backend already uses:
 * - a SPACE-PADDED single word (" mint", "mint ", " mint ") is a lure word. The
 *   padding was a one-sided word-boundary hack that misfired on words like
 *   "papermint", so we strip it and match it as a whole word instead (see
 *   `toWords`). Padded duplicates collapse to one entry, so the backend can also
 *   send a single padded variant per word.
 * - everything else — a BARE pattern ("https", "www.", a full symbol/name) or a
 *   padded multi-word phrase — keeps the case-insensitive SUBSTRING contract and
 *   matches anywhere.
 */
export const prepareBlacklistPatterns = (rawPatterns: string[]): PreparedBlacklistPatterns => {
  const wordPatterns = new Set<string>()
  const substringPatterns = new Set<string>()

  for (const raw of rawPatterns) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const pattern = trimmed.toLowerCase()
    // Surrounding whitespace marks a lure word; a bare pattern (or a padded
    // multi-word phrase, which has no single whole-word token) stays a substring.
    const isPaddedLureWord = trimmed !== raw && !pattern.includes(' ')
    if (isPaddedLureWord) wordPatterns.add(pattern)
    else substringPatterns.add(pattern)
  }

  return {
    wordPatterns: [...wordPatterns],
    substringPatterns: [...substringPatterns]
  }
}

/**
 * Decides whether an asset (ERC-20 token or NFT collection) should be hidden as
 * spam based on its symbol and name. Custom (user-added) assets are never hidden.
 *
 * Spam often hides the lure in the name rather than the symbol, so both are
 * checked, combining the prepared blacklist patterns (see
 * `prepareBlacklistPatterns`) with a domain-like detector (see
 * `containsDomainLike`):
 * - word patterns ("airdrop", "claim") match only on word boundaries, so
 *   "free mint" is hidden but "papermint protocol" is not
 * - substring patterns ("www.", "t.me") match anywhere
 *
 * The symbol and name are matched SEPARATELY and never joined into one string,
 * so a token with symbol "WIN" plus a name does not gain an artificial boundary.
 *
 * Word patterns only fire inside MULTI-WORD text. A single-token symbol or name
 * — "WIN", "WETH", even "WIN-AIRDROP" — is left visible, because a legitimate
 * ticker often collides with a lure word; the spam we target reads as a phrase
 * ("claim your airdrop now"), where the lure sits among other words. Substring
 * patterns ("www.", "https") ignore this gate and still match a single token.
 */
export const isBlacklistedAsset = ({
  symbol,
  name,
  isCustom,
  patterns,
  checkForEmbeddedDomain
}: {
  symbol: string
  name?: string
  isCustom?: boolean
  patterns: PreparedBlacklistPatterns
  checkForEmbeddedDomain?: boolean
}): boolean => {
  if (isCustom) return false

  const haystacks = [symbol.toLowerCase(), ...(name ? [name.toLowerCase()] : [])]

  const matchesSubstringPattern = haystacks.some((haystack) =>
    patterns.substringPatterns.some((pattern) => haystack.includes(pattern))
  )
  if (matchesSubstringPattern) return true

  const matchesWordPattern = haystacks.some((haystack) => {
    const trimmed = haystack.trim()
    // Lure words count only in multi-word text, so a single-token symbol/name
    // (e.g. "WIN") stays visible even when it embeds a lure across punctuation.
    if (!isMultiWord(trimmed)) return false
    const words = new Set(toWords(trimmed))
    return patterns.wordPatterns.some((pattern) => words.has(pattern))
  })
  if (matchesWordPattern) return true

  if (!checkForEmbeddedDomain) return false

  const embedsPhishingDomain = haystacks.some((haystack) => containsDomainLike(haystack))
  return embedsPhishingDomain
}
