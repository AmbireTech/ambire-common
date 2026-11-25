import { SentToHistory } from '../../controllers/activity/types'
import { Domains } from '../../interfaces/domains'
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
 * Names this short are skipped by the one-typo check, since almost every other short name is one
 * typo away from them. The lookalike check still runs, because `a1b.eth` posing as `alb.eth` is
 * still a trick.
 */
const SHORT_NAME_MAX_LENGTH = 3

/** The domain without its ending, like `abc` for `abc.eth`. */
const getNameWithoutEnding = (domain: string) => {
  const endingStartIndex = domain.lastIndexOf('.')
  if (endingStartIndex === -1) return domain

  return domain.slice(0, endingStartIndex)
}

const getIsShortName = (domain: string) =>
  getNameWithoutEnding(domain).length <= SHORT_NAME_MAX_LENGTH

const getIsTypo = (
  typedDomain: string,
  typedDomainWithoutLookalikes: string,
  knownDomain: string
): boolean => {
  if (typedDomainWithoutLookalikes === replaceLookalikeChars(knownDomain)) return true
  if (getIsShortName(typedDomain) && getIsShortName(knownDomain)) return false

  return getIsOneTypoApart(typedDomain, knownDomain)
}

/**
 * Names of Address Book entries, lowercased, each mapped to the address it belongs to. See
 * `getAddressBookDomains`.
 */
export type AddressBookDomains = { [domain: string]: string }

/**
 * Collects the names that `domains` holds for `addresses`, from every name service.
 *
 * These names come from the cached reverse lookup, so they are the name each address chose for
 * itself, not a name the user typed. The lookup checks that the name pointed back to the address,
 * but only at the time it ran. The cache can be old, or empty when the lookup has not run yet or
 * is turned off for privacy. So use these names only to spot a typo, and never save them as names
 * the user sent to, because the "name now points to another address" warning would then fire for
 * names the user never used.
 */
export const getAddressBookDomains = (addresses: string[], domains: Domains): AddressBookDomains =>
  addresses.reduce<AddressBookDomains>((addressBookDomains, address) => {
    Object.values(domains[address]?.names ?? {}).forEach((name) => {
      const normalizedName = name?.toLowerCase().trim()
      if (normalizedName) addressBookDomains[normalizedName] = address
    })

    return addressBookDomains
  }, {})

/**
 * Finds the domain the user most likely meant when the typed one is new to them. A known domain
 * matches when it is one typo away (see `getIsOneTypoApart`) or reads the same once lookalike chars
 * like `rn` and `m` are swapped. When both names are 3 chars or shorter, only lookalikes match.
 *
 * Domains the user sent to come first, and on several matches the most recently used one wins.
 * Address Book names (see `getAddressBookDomains`) are checked only when no sent-to domain
 * matches, which covers a recipient the user always picks from the Address Book and never types.
 *
 * Known domains that point to `resolvedAddress` are skipped, since sending there reaches the same
 * recipient anyway. Returns null when nothing matches, or when the typed domain is itself a known
 * one. That holds even when the known domain now points to another address, since that is a
 * changed name and not a typo.
 */
export const getDomainTypoMatch = (
  typedDomain: string,
  resolvedAddress: string,
  sentToDomains: SentToHistory['domains'],
  addressBookDomains: AddressBookDomains
): DomainTypoMatch | null => {
  const normalizedTypedDomain = typedDomain.toLowerCase().trim()
  if (!normalizedTypedDomain) return null
  if (sentToDomains[normalizedTypedDomain] || addressBookDomains[normalizedTypedDomain]) return null

  const typedDomainWithoutLookalikes = replaceLookalikeChars(normalizedTypedDomain)
  const getIsTypoOfKnownDomain = (knownDomain: string, knownAddress: string) =>
    knownAddress.toLowerCase() !== resolvedAddress.toLowerCase() &&
    getIsTypo(normalizedTypedDomain, typedDomainWithoutLookalikes, knownDomain)

  let bestSentToMatch: { domain: string; sentAt: number } | null = null

  for (const [domain, { address, sentAt }] of Object.entries(sentToDomains)) {
    if (bestSentToMatch && bestSentToMatch.sentAt >= sentAt) continue
    if (getIsTypoOfKnownDomain(domain, address)) bestSentToMatch = { domain, sentAt }
  }

  if (bestSentToMatch) return { matchedDomain: bestSentToMatch.domain, source: 'sentTo' }

  const addressBookMatch = Object.entries(addressBookDomains).find(([domain, address]) =>
    getIsTypoOfKnownDomain(domain, address)
  )

  return addressBookMatch ? { matchedDomain: addressBookMatch[0], source: 'addressBook' } : null
}
