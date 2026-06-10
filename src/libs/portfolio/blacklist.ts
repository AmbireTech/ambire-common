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
  (char >= 'a' && char <= 'z') ||
  (char >= '0' && char <= '9') ||
  char === '.' ||
  char === '-'

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

/**
 * Decides whether an asset (ERC-20 token or NFT collection) should be hidden as
 * spam based on its symbol and name. Custom (user-added) assets are never hidden.
 *
 * Spam often hides the lure in the name rather than the symbol, so both are
 * checked, combining two signals:
 * - substring patterns from the static + dynamic blacklist (e.g. "https", "www.")
 * - a domain-like detector (see `containsDomainLike`)
 *
 * `lowercasedPatterns` must already be lowercased by the caller.
 */
export const isBlacklistedAsset = ({
  symbol,
  name,
  isCustom,
  lowercasedPatterns
}: {
  symbol: string
  name?: string
  isCustom?: boolean
  lowercasedPatterns: string[]
}): boolean => {
  if (isCustom) return false

  const haystack = `${symbol} ${name || ''}`.toLowerCase()

  if (lowercasedPatterns.some((pattern) => haystack.includes(pattern))) return true

  return containsDomainLike(haystack)
}
