import { SentToHistory } from '../../controllers/activity/types'
import { DomainTypoMatch } from '../../interfaces/transfer'

/**
 * Char sequences that look alike in most fonts, with the one each is read as. ENS normalization
 * already rejects lookalikes from other alphabets, so only plain ASCII ones are left.
 */
const LOOKALIKE_CHAR_SEQUENCES: [lookalike: string, original: string][] = [
  ['rn', 'm'],
  ['vv', 'w'],
  ['1', 'l'],
  ['0', 'o']
]

const replaceLookalikeChars = (domain: string) =>
  LOOKALIKE_CHAR_SEQUENCES.reduce(
    (result, [lookalike, original]) => result.split(lookalike).join(original),
    domain
  )

/**
 * Whether one typo turns `a` into `b`: one char added, removed or replaced, or two chars next to
 * each other swapped. Identical strings are not a typo.
 */
const getIsOneTypoApart = (a: string, b: string): boolean => {
  if (a === b) return false

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (longer.length - shorter.length > 1) return false

  let firstDifferenceIndex = 0
  while (
    firstDifferenceIndex < shorter.length &&
    shorter[firstDifferenceIndex] === longer[firstDifferenceIndex]
  ) {
    firstDifferenceIndex += 1
  }

  if (shorter.length !== longer.length) {
    return shorter.slice(firstDifferenceIndex) === longer.slice(firstDifferenceIndex + 1)
  }

  const isReplacedChar =
    shorter.slice(firstDifferenceIndex + 1) === longer.slice(firstDifferenceIndex + 1)
  const isSwappedPair =
    shorter[firstDifferenceIndex] === longer[firstDifferenceIndex + 1] &&
    shorter[firstDifferenceIndex + 1] === longer[firstDifferenceIndex] &&
    shorter.slice(firstDifferenceIndex + 2) === longer.slice(firstDifferenceIndex + 2)

  return isReplacedChar || isSwappedPair
}

/**
 * Finds the domain the user most likely meant when the typed one is new to them: a domain they
 * have sent to before that is one typo away (see `getIsOneTypoApart`), or that reads the same
 * once lookalike chars like `rn` and `m` are swapped. Domains that point to `resolvedAddress`
 * are skipped, since sending there reaches the same recipient anyway. On several matches the
 * most recently used one wins. Returns null when the typed domain was sent to before or nothing
 * matches.
 */
export const getDomainTypoMatch = (
  typedDomain: string,
  resolvedAddress: string,
  sentToDomains: SentToHistory['domains']
): DomainTypoMatch | null => {
  const normalizedTypedDomain = typedDomain.toLowerCase().trim()
  if (!normalizedTypedDomain || sentToDomains[normalizedTypedDomain]) return null

  const typedDomainWithoutLookalikes = replaceLookalikeChars(normalizedTypedDomain)
  let bestMatch: { domain: string; sentAt: number } | null = null

  for (const [domain, { address, sentAt }] of Object.entries(sentToDomains)) {
    if (address.toLowerCase() === resolvedAddress.toLowerCase()) continue
    if (bestMatch && bestMatch.sentAt >= sentAt) continue

    const isTypo =
      getIsOneTypoApart(normalizedTypedDomain, domain) ||
      typedDomainWithoutLookalikes === replaceLookalikeChars(domain)
    if (isTypo) bestMatch = { domain, sentAt }
  }

  return bestMatch ? { matchedDomain: bestMatch.domain } : null
}
