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
 * Adds to the domains the user typed when sending the Address Book names of addresses in
 * `sentToRecipients`, each with the time of the last send there. This covers a recipient the user
 * picks from the Address Book, since that saves no domain with the send.
 *
 * Names of addresses the user never sent to are left out. Anyone can get an address into the
 * Address Book, and the typo warning offers to switch to the matched name, so a planted lookalike
 * could otherwise steer the user to it. A past send makes the name as trusted as a typed one.
 * When a name is in both, the typed one is kept, since it is what the user used.
 */
export const getKnownDomains = (
  sentToDomains: SentToHistory['domains'],
  addressBookDomains: AddressBookDomains,
  sentToRecipients: SentToHistory['recipients'][string] | undefined
): SentToHistory['domains'] => {
  const knownDomains = { ...sentToDomains }

  Object.entries(addressBookDomains).forEach(([domain, address]) => {
    const sentAt = sentToRecipients?.[address]
    if (!sentAt || knownDomains[domain]) return

    knownDomains[domain] = { address, sentAt }
  })

  return knownDomains
}

/**
 * Finds the domain the user most likely meant when the typed one is new to them: a known domain
 * (see `getKnownDomains`) that is one typo away (see `getIsOneTypoApart`), or that reads the same
 * once lookalike chars like `rn` and `m` are swapped. When both names are 3 chars or shorter, only
 * lookalikes match. Domains that point to `resolvedAddress` are skipped, since sending there
 * reaches the same recipient anyway. On several matches the most recently used one wins.
 *
 * Returns null when nothing matches, or when the typed domain is itself a known one. That holds
 * even when the known domain now points to another address, since that is a changed name and not
 * a typo.
 */
export const getDomainTypoMatch = (
  typedDomain: string,
  resolvedAddress: string,
  knownDomains: SentToHistory['domains']
): DomainTypoMatch | null => {
  const normalizedTypedDomain = typedDomain.toLowerCase().trim()
  if (!normalizedTypedDomain || knownDomains[normalizedTypedDomain]) return null

  const typedDomainWithoutLookalikes = replaceLookalikeChars(normalizedTypedDomain)
  let bestMatch: { domain: string; sentAt: number } | null = null

  for (const [domain, { address, sentAt }] of Object.entries(knownDomains)) {
    if (address.toLowerCase() === resolvedAddress.toLowerCase()) continue
    if (bestMatch && bestMatch.sentAt >= sentAt) continue

    if (getIsTypo(normalizedTypedDomain, typedDomainWithoutLookalikes, domain)) {
      bestMatch = { domain, sentAt }
    }
  }

  return bestMatch ? { matchedDomain: bestMatch.domain } : null
}
