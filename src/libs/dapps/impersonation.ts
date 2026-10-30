import { getDomain, getDomainWithoutSuffix } from 'tldts'

/**
 * A well-known app that phishing sites commonly pretend to be.
 */
type ImpersonationTarget = {
  /** How the app is called in the warnings shown to the user */
  name: string
  /**
   * The official root domains of the app (e.g. "uniswap.org"). The first one is shown to the user.
   * Old domains the app moved away from are kept, as people still use them.
   */
  domains: string[]
  /** Other names the app goes by. `name` is always checked too */
  aliases?: string[]
  /**
   * Set for apps named after a common word ("Safe", "Curve"). Unrelated sites often have such words
   * in their domains ("safe-haven.com"), so only the exact name with another ending is flagged.
   */
  isCommonWord?: boolean
}

/**
 * Hand-picked list of apps that are commonly impersonated by phishing sites. Kept short on purpose,
 * like MetaMask's fuzzylist - checking a site against every app in the catalog would flag
 * legitimate sites that happen to share a generic name ("Swap", "Bridge") with some app.
 * Apps with very generic names or domains (e.g. "Sky", "Relay", "Base") are left out for the same
 * reason.
 */
const IMPERSONATION_TARGETS: ImpersonationTarget[] = [
  { name: 'Uniswap', domains: ['uniswap.org'] },
  { name: '1inch', domains: ['1inch.com', '1inch.io'] },
  { name: 'Jumper', domains: ['jumper.xyz', 'jumper.exchange'] },
  { name: 'OpenSea', domains: ['opensea.io'] },
  { name: 'Blur', domains: ['blur.io'], isCommonWord: true },
  { name: 'Aave', domains: ['aave.com'] },
  { name: 'Lido', domains: ['lido.fi'] },
  { name: 'Curve', domains: ['curve.finance', 'curve.fi'], isCommonWord: true },
  { name: 'PancakeSwap', domains: ['pancakeswap.finance'] },
  { name: 'SushiSwap', domains: ['sushi.com'], aliases: ['Sushi'] },
  { name: 'Balancer', domains: ['balancer.fi'], isCommonWord: true },
  { name: 'Compound', domains: ['compound.xyz', 'compound.finance'], isCommonWord: true },
  { name: 'Pendle', domains: ['pendle.finance'] },
  { name: 'Morpho', domains: ['morpho.org'] },
  { name: 'GMX', domains: ['gmx.io'] },
  { name: 'Hyperliquid', domains: ['hyperliquid.xyz'] },
  { name: 'Stargate', domains: ['stargate.finance'], isCommonWord: true },
  { name: 'Across', domains: ['across.to'], isCommonWord: true },
  { name: 'CoW Swap', domains: ['cow.fi'], aliases: ['CoW Protocol'] },
  { name: 'Zora', domains: ['zora.co'] },
  { name: 'ENS', domains: ['ens.domains'] },
  { name: 'Safe', domains: ['safe.global'], aliases: ['Safe{Wallet}'], isCommonWord: true },
  { name: 'Matcha', domains: ['matcha.xyz'], isCommonWord: true },
  { name: 'Polymarket', domains: ['polymarket.com'] },
  { name: 'Magic Eden', domains: ['magiceden.io'] },
  { name: 'Ethena', domains: ['ethena.fi'] },
  { name: 'Rocket Pool', domains: ['rocketpool.net'] },
  { name: 'Convex', domains: ['convexfinance.com'], isCommonWord: true },
  { name: 'Yearn', domains: ['yearn.fi'] },
  { name: 'KyberSwap', domains: ['kyberswap.com'] },
  { name: 'EigenLayer', domains: ['eigenlayer.xyz', 'eigencloud.xyz'] },
  { name: 'Arbitrum', domains: ['arbitrum.io', 'arbitrum.foundation'] },
  { name: 'Revoke', domains: ['revoke.cash'], aliases: ['Revoke.cash'], isCommonWord: true },
  { name: 'Etherscan', domains: ['etherscan.io'] },
  { name: 'MetaMask', domains: ['metamask.io'] },
  { name: 'Rabby', domains: ['rabby.io'] },
  { name: 'Ambire', domains: ['ambire.com'] }
]

/**
 * Words that apps commonly add after their name ("Uniswap Interface", "Lido Finance"). They are
 * dropped from the end of a name before comparing, so they can't be used to dodge the name check.
 */
const GENERIC_NAME_SUFFIXES = [
  'app',
  'dapp',
  'interface',
  'exchange',
  'protocol',
  'finance',
  'labs',
  'dao',
  'wallet',
  'official'
]

/**
 * Words phishing sites commonly add around the name of the app they pretend to be ("Uniswap
 * Airdrop", "Claim | Uniswap", "Uniswap V4"). A name made only of an app's name and these words (or
 * the generic suffixes) is treated as the app's name. Any other word means the site isn't flagged,
 * so third-party tools that mention an app ("Aave Dashboard by DeFi Saver") aren't affected.
 */
const BAIT_WORDS = [
  'airdrop',
  'claim',
  'claims',
  'reward',
  'rewards',
  'bonus',
  'giveaway',
  'migrate',
  'migration',
  'verify',
  'verification',
  'v2',
  'v3',
  'v4',
  'v5'
]

const FILLER_WORDS = [...GENERIC_NAME_SUFFIXES, ...BAIT_WORDS]

/**
 * Letters from other alphabets that look like latin ones (e.g. cyrillic "а" and latin "a"), which
 * phishing sites use to make a domain or name look like the original one.
 */
const LATIN_LOOKALIKES: Record<string, string> = {
  // Cyrillic
  а: 'a',
  в: 'b',
  ь: 'b',
  с: 'c',
  ԁ: 'd',
  е: 'e',
  һ: 'h',
  і: 'i',
  ј: 'j',
  к: 'k',
  ӏ: 'l',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  ԛ: 'q',
  ѕ: 's',
  т: 't',
  у: 'y',
  ԝ: 'w',
  х: 'x',
  // Greek
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  γ: 'y',
  ω: 'w',
  // Latin letters without a dot
  ı: 'i',
  ȷ: 'j'
}

/** Accents and other marks that are added on top of a letter ("à" is "a" + "̀") */
const COMBINING_MARKS_START = 0x0300
const COMBINING_MARKS_END = 0x036f

/**
 * Replaces letters that look like latin ones with their latin twin and drops accents (e.g.
 * "uniswаp" with a cyrillic "а", or "unìswap", both become "uniswap").
 */
const toLatinLookalikes = (text: string): string => {
  let result = ''
  for (const char of text.toLowerCase().normalize('NFD')) {
    const codePoint = char.codePointAt(0)!
    if (codePoint >= COMBINING_MARKS_START && codePoint <= COMBINING_MARKS_END) continue

    result += LATIN_LOOKALIKES[char] ?? char
  }

  return result
}

// Constants of the punycode algorithm, see https://datatracker.ietf.org/doc/html/rfc3492#section-5
const PUNYCODE_BASE = 36
const PUNYCODE_T_MIN = 1
const PUNYCODE_T_MAX = 26
const PUNYCODE_SKEW = 38
const PUNYCODE_DAMP = 700
const PUNYCODE_INITIAL_BIAS = 72
const PUNYCODE_INITIAL_N = 128
const MAX_CODE_POINT = 0x10ffff
const PUNYCODE_PREFIX = 'xn--'

const adaptPunycodeBias = (delta: number, numPoints: number, isFirstTime: boolean) => {
  let scaledDelta = isFirstTime ? Math.floor(delta / PUNYCODE_DAMP) : Math.floor(delta / 2)
  scaledDelta += Math.floor(scaledDelta / numPoints)

  let k = 0
  while (scaledDelta > ((PUNYCODE_BASE - PUNYCODE_T_MIN) * PUNYCODE_T_MAX) / 2) {
    scaledDelta = Math.floor(scaledDelta / (PUNYCODE_BASE - PUNYCODE_T_MIN))
    k += PUNYCODE_BASE
  }

  return (
    k +
    Math.floor(((PUNYCODE_BASE - PUNYCODE_T_MIN + 1) * scaledDelta) / (scaledDelta + PUNYCODE_SKEW))
  )
}

const getPunycodeDigit = (char: string) => {
  const code = char.charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 22 // 0-9 are the digits 26-35
  if (code >= 97 && code <= 122) return code - 97 // a-z are the digits 0-25
  if (code >= 65 && code <= 90) return code - 65 // A-Z are the digits 0-25

  return -1
}

/**
 * Decodes a punycode label without its "xn--" prefix (e.g. "uniswp-7nf" becomes "uniswаp" with a
 * cyrillic "а"). Returns null if the label isn't valid punycode.
 */
const decodePunycodeLabel = (label: string): string | null => {
  const delimiterIndex = Math.max(label.lastIndexOf('-'), 0)
  const output = Array.from(label.slice(0, delimiterIndex))
  let index = delimiterIndex > 0 ? delimiterIndex + 1 : 0
  let i = 0
  let n = PUNYCODE_INITIAL_N
  let bias = PUNYCODE_INITIAL_BIAS

  while (index < label.length) {
    const previousI = i
    let weight = 1
    for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
      if (index >= label.length) return null

      const digit = getPunycodeDigit(label[index++]!)
      if (digit < 0) return null

      i += digit * weight
      const threshold =
        k <= bias ? PUNYCODE_T_MIN : k >= bias + PUNYCODE_T_MAX ? PUNYCODE_T_MAX : k - bias
      if (digit < threshold) break

      weight *= PUNYCODE_BASE - threshold
    }

    bias = adaptPunycodeBias(i - previousI, output.length + 1, previousI === 0)
    n += Math.floor(i / (output.length + 1))
    if (n > MAX_CODE_POINT) return null

    i %= output.length + 1
    output.splice(i, 0, String.fromCodePoint(n))
    i++
  }

  return output.join('')
}

/**
 * Brings a domain label (e.g. "xn--uniswp-7nf") to the latin letters it looks like ("uniswap").
 * Browsers give domains with letters from other alphabets in their punycode form, so it is decoded
 * first.
 */
const toLatinDomainLabel = (label: string): string => {
  if (!label.startsWith(PUNYCODE_PREFIX)) return toLatinLookalikes(label)

  const decodedLabel = decodePunycodeLabel(label.slice(PUNYCODE_PREFIX.length))
  return toLatinLookalikes(decodedLabel ?? label)
}

/**
 * Only domain names at least this long are matched when they differ by one character, as shorter
 * ones are one character away from too many unrelated apps (e.g. "thena" - "ethena",
 * "9inch" - "1inch", "pumper" - "jumper").
 */
const MIN_LENGTH_FOR_FUZZY_DOMAIN_MATCH = 7

type ImpersonationReason = 'name' | 'icon' | 'domain'

type Impersonation = {
  /** The name of the app the site pretends to be */
  appName: string
  /** The official domain of the app the site pretends to be */
  appDomain: string
  reason: ImpersonationReason
}

const isLetterOrDigit = (char: string) => {
  const lower = char.toLowerCase()
  return (lower >= 'a' && lower <= 'z') || (lower >= '0' && lower <= '9')
}

/** Splits a text into lowercase words made only of latin letters and digits. */
const toWords = (text: string): string[] => {
  const words: string[] = []
  let currentWord = ''

  for (const char of text) {
    if (isLetterOrDigit(char)) {
      currentWord += char.toLowerCase()
    } else if (currentWord) {
      words.push(currentWord)
      currentWord = ''
    }
  }
  if (currentWord) words.push(currentWord)

  return words
}

/**
 * Brings an app name to a comparable form - lowercase, without spaces, punctuation and generic
 * suffixes. E.g. "Uniswap Interface" and "uniswap" both become "uniswap".
 */
const normalizeAppName = (name: string): string => {
  const words = toWords(name)
  while (words.length > 1 && GENERIC_NAME_SUFFIXES.includes(words[words.length - 1]!)) {
    words.pop()
  }

  return words.join('')
}

/** Whether two strings differ by at most one inserted, removed or replaced character. */
const isWithinOneEdit = (a: string, b: string): boolean => {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  let shorterIndex = 0
  let longerIndex = 0
  let hasEdit = false

  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex++
      longerIndex++
      continue
    }
    if (hasEdit) return false

    hasEdit = true
    // Same length - a replaced character, otherwise - an inserted one
    if (shorter.length === longer.length) shorterIndex++
    longerIndex++
  }

  return true
}

/**
 * Whether the site's domain name (without the ending, e.g. "uniswap-app" for "uniswap-app.com")
 * looks like the app's own domain name - same name with another ending ("uniswap.app"), one
 * character off ("un1swap.org") or the name with words added ("uniswap-airdrop.com"). For apps
 * named after a common word, only the first one counts.
 */
const isLookalikeDomainName = (
  siteDomainName: string,
  appDomainName: string,
  isCommonWord: boolean
): boolean => {
  if (siteDomainName === appDomainName) return true
  if (isCommonWord) return false
  if (siteDomainName.split('-').includes(appDomainName)) return true

  return (
    appDomainName.length >= MIN_LENGTH_FOR_FUZZY_DOMAIN_MATCH &&
    isWithinOneEdit(siteDomainName, appDomainName)
  )
}

/** Joins the words of a name, leaving out the filler words (e.g. "Claim | Uniswap" - "uniswap"). */
const removeFillerWords = (name: string): string =>
  toWords(name)
    .filter((word) => !FILLER_WORDS.includes(word))
    .join('')

const findTargetByName = (siteName: string) => {
  const normalizedName = normalizeAppName(siteName)
  const nameWithoutFillers = removeFillerWords(siteName)

  return IMPERSONATION_TARGETS.find((target) =>
    [target.name, ...(target.aliases ?? [])].some((appName) => {
      const normalizedAppName = normalizeAppName(appName)
      if (normalizedAppName === normalizedName) return true

      // Apps named after a common word only match their exact name ("Safe Rewards" may be anything)
      return !target.isCommonWord && normalizedAppName === nameWithoutFillers
    })
  )
}

const findTargetByDomain = (rootDomain: string) =>
  IMPERSONATION_TARGETS.find((target) => target.domains.includes(rootDomain))

const findTargetByLookalikeDomain = (siteDomainName: string) =>
  IMPERSONATION_TARGETS.find((target) =>
    target.domains.some((domain) => {
      const appDomainName = getDomainWithoutSuffix(domain)
      return (
        !!appDomainName &&
        isLookalikeDomainName(siteDomainName, appDomainName, !!target.isCommonWord)
      )
    })
  )

const toImpersonation = (
  target: ImpersonationTarget,
  reason: ImpersonationReason
): Impersonation => ({ appName: target.name, appDomain: target.domains[0]!, reason })

/**
 * Detects a site that pretends to be a well-known app (from a hand-picked list), so the user can be
 * warned before connecting to it. New phishing sites take a while to get on the phishing lists, but
 * most of them copy the name, logo or domain of the app they pretend to be.
 *
 * The checks, from strongest to weakest signal:
 * 1. icon - the site's icon is loaded from the app's official domain
 * 2. name - the site calls itself by the app's name
 * 3. domain - the site's domain looks like the app's official domain
 *
 * Sites that are part of the app catalog are never flagged - the catalog follows the apps when
 * they move to a new domain. Neither are sites without a public domain (localhost, IP addresses),
 * as these are commonly used by developers running a copy of an app.
 */
const getImpersonation = ({
  hostname,
  name,
  icon,
  isInAppCatalog
}: {
  /** The site's hostname, e.g. "app.uniswap.org" */
  hostname: string
  /** The name the site gives itself */
  name?: string | null
  /** The url of the icon the site declares */
  icon?: string | null
  isInAppCatalog: boolean
}): Impersonation | null => {
  if (isInAppCatalog) return null

  const siteRootDomain = getDomain(hostname)
  // On shared hosting (e.g. "uniswap-claim.vercel.app") the site's own part of the domain is
  // compared, not the platform's ("vercel"). The official domain check below stays on the root
  // domain, so a site on a shared platform can never pass for the app itself.
  const siteDomainName = getDomainWithoutSuffix(hostname, { allowPrivateDomains: true })
  if (!siteRootDomain || !siteDomainName) return null

  // The site is the app itself
  if (findTargetByDomain(siteRootDomain)) return null

  const iconRootDomain = icon ? getDomain(icon) : null
  const targetByIcon = iconRootDomain ? findTargetByDomain(iconRootDomain) : undefined
  if (targetByIcon) return toImpersonation(targetByIcon, 'icon')

  const targetByName = name ? findTargetByName(toLatinLookalikes(name)) : undefined
  if (targetByName) return toImpersonation(targetByName, 'name')

  // Letters from other alphabets are replaced only for this comparison - a domain that equals an
  // official one only after replacing them ("uniswаp.org" with a cyrillic "а") is a lookalike
  const targetByDomain = findTargetByLookalikeDomain(toLatinDomainLabel(siteDomainName))
  if (targetByDomain) return toImpersonation(targetByDomain, 'domain')

  return null
}

export type { Impersonation, ImpersonationReason }
export {
  decodePunycodeLabel,
  getImpersonation,
  IMPERSONATION_TARGETS,
  isWithinOneEdit,
  normalizeAppName,
  toLatinLookalikes
}
