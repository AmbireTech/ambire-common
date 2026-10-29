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

const findTargetByName = (normalizedName: string) =>
  IMPERSONATION_TARGETS.find((target) =>
    [target.name, ...(target.aliases ?? [])].some(
      (name) => normalizeAppName(name) === normalizedName
    )
  )

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
  const siteDomainName = getDomainWithoutSuffix(hostname)
  if (!siteRootDomain || !siteDomainName) return null

  // The site is the app itself
  if (findTargetByDomain(siteRootDomain)) return null

  const iconRootDomain = icon ? getDomain(icon) : null
  const targetByIcon = iconRootDomain ? findTargetByDomain(iconRootDomain) : undefined
  if (targetByIcon) return toImpersonation(targetByIcon, 'icon')

  const normalizedName = name ? normalizeAppName(name) : ''
  const targetByName = normalizedName ? findTargetByName(normalizedName) : undefined
  if (targetByName) return toImpersonation(targetByName, 'name')

  const targetByDomain = findTargetByLookalikeDomain(siteDomainName)
  if (targetByDomain) return toImpersonation(targetByDomain, 'domain')

  return null
}

export type { Impersonation, ImpersonationReason }
export { getImpersonation, IMPERSONATION_TARGETS, isWithinOneEdit, normalizeAppName }
