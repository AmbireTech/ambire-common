import { describe, expect, test } from '@jest/globals'

import { SentToHistory } from '../../controllers/activity/types'
import { Domains } from '../../interfaces/domains'
import { getAddressBookDomains, getDomainTypoMatch, getKnownDomains } from './domain-typo'

const MOVE_ADDRESS = '0x1111111111111111111111111111111111111111'
const REMOVE_ADDRESS = '0x2222222222222222222222222222222222222222'
const BOBBY_ADDRESS = '0x3333333333333333333333333333333333333333'
const COBBY_ADDRESS = '0x4444444444444444444444444444444444444444'
const VITALIK_ADDRESS = '0x5555555555555555555555555555555555555555'
const ABC_ADDRESS = '0x6666666666666666666666666666666666666666'
const CONTACT_ADDRESS = '0x7777777777777777777777777777777777777777'
const TYPED_DOMAIN_ADDRESS = '0x9999999999999999999999999999999999999999'

const sentToDomains: SentToHistory['domains'] = {
  'move.eth': { address: MOVE_ADDRESS, sentAt: 1000 },
  // Newer than move.eth, so it would win any tie against it
  'remove.eth': { address: REMOVE_ADDRESS, sentAt: 5000 },
  'bobby.eth': { address: BOBBY_ADDRESS, sentAt: 2000 },
  'cobby.eth': { address: COBBY_ADDRESS, sentAt: 3000 },
  'vitalik.eth': { address: VITALIK_ADDRESS, sentAt: 4000 },
  'abc.eth': { address: ABC_ADDRESS, sentAt: 500 },
  'alb.eth': { address: ABC_ADDRESS, sentAt: 500 }
}

const findMatchedDomain = (typedDomain: string, resolvedAddress = TYPED_DOMAIN_ADDRESS) =>
  getDomainTypoMatch(typedDomain, resolvedAddress, sentToDomains)?.matchedDomain ?? null

describe('getDomainTypoMatch', () => {
  test.each([
    ['mpve.eth', 'move.eth', 'a replaced char'],
    ['mve.eth', 'move.eth', 'a removed char'],
    ['ove.eth', 'move.eth', 'a removed first char'],
    ['moove.eth', 'move.eth', 'an added char'],
    ['mvoe.eth', 'move.eth', 'two chars next to each other swapped'],
    ['move.eht', 'move.eth', 'a swapped pair at the end'],
    ['rnove.eth', 'move.eth', '"rn" instead of "m"'],
    ['vita1ik.eth', 'vitalik.eth', '"1" instead of "l"'],
    ['  RNove.ETH ', 'move.eth', 'a lookalike typed in uppercase with spaces']
  ])('matches %s to %s (%s)', (typedDomain, expectedDomain) => {
    expect(findMatchedDomain(typedDomain)).toBe(expectedDomain)
  })

  test.each([
    ['mxoe.eth', 'a swap and a replaced char'],
    ['mvoe.etx', 'a swap and a replaced char at the end'],
    ['mo.eth', 'two removed chars'],
    ['move.btc', 'the same name with another ending'],
    ['alice.eth', 'an unrelated name']
  ])('does not match %s (%s)', (typedDomain) => {
    expect(findMatchedDomain(typedDomain)).toBeNull()
  })

  test('does not match a name that is only contained in a longer known name', () => {
    // "move.eth" is inside "remove.eth", but two chars are missing
    expect(
      getDomainTypoMatch('move.eth', TYPED_DOMAIN_ADDRESS, {
        'remove.eth': sentToDomains['remove.eth']!
      })
    ).toBeNull()
  })

  test('picks the one-typo name over a newer name that only contains the typed text', () => {
    // A fuzzy search ranks remove.eth the same as move.eth here, and remove.eth is newer
    expect(findMatchedDomain('movee.eth')).toBe('move.eth')
  })

  test('picks the most recently used name when several are one typo away', () => {
    // Both bobby.eth and cobby.eth are one char away from robby.eth
    expect(findMatchedDomain('robby.eth')).toBe('cobby.eth')
  })

  test('returns null when the typed name was sent to before', () => {
    // bobby.eth is one char away from cobby.eth, but the user knows bobby.eth already
    expect(findMatchedDomain('bobby.eth')).toBeNull()
    expect(findMatchedDomain(' BOBBY.eth')).toBeNull()
  })

  test('skips a known name that points to the same address as the typed one', () => {
    expect(findMatchedDomain('mpve.eth', MOVE_ADDRESS)).toBeNull()
  })

  test('falls back to another match when the newest one points to the same address', () => {
    expect(findMatchedDomain('robby.eth', COBBY_ADDRESS)).toBe('bobby.eth')
  })

  test('returns null for an empty name or no history', () => {
    expect(findMatchedDomain('  ')).toBeNull()
    expect(getDomainTypoMatch('mpve.eth', TYPED_DOMAIN_ADDRESS, {})).toBeNull()
  })

  test.each([
    ['abd.eth', 'a replaced char'],
    ['ab.eth', 'a removed char'],
    ['bac.eth', 'two chars next to each other swapped']
  ])('does not match %s to abc.eth, as both names are 3 chars or shorter (%s)', (typedDomain) => {
    expect(findMatchedDomain(typedDomain)).toBeNull()
  })

  test('still matches a lookalike when both names are 3 chars or shorter', () => {
    expect(findMatchedDomain('a1b.eth')).toBe('alb.eth')
  })

  test('still matches a one-char typo when only the typed name is 3 chars or shorter', () => {
    expect(findMatchedDomain('mov.eth')).toBe('move.eth')
  })
})

describe('getKnownDomains', () => {
  const addressBookDomains = { 'satoshi.eth': CONTACT_ADDRESS }

  test('adds an Address Book name the user sent to, with the time of the last send', () => {
    const knownDomains = getKnownDomains(sentToDomains, addressBookDomains, {
      [CONTACT_ADDRESS]: 9000
    })

    expect(knownDomains['satoshi.eth']).toEqual({ address: CONTACT_ADDRESS, sentAt: 9000 })
    expect(getDomainTypoMatch('sat0shi.eth', TYPED_DOMAIN_ADDRESS, knownDomains)).toEqual({
      matchedDomain: 'satoshi.eth'
    })
  })

  test('leaves out an Address Book name the user never sent to', () => {
    const knownDomains = getKnownDomains(sentToDomains, addressBookDomains, {
      [MOVE_ADDRESS]: 9000
    })

    expect(knownDomains['satoshi.eth']).toBeUndefined()
    expect(getDomainTypoMatch('sat0shi.eth', TYPED_DOMAIN_ADDRESS, knownDomains)).toBeNull()
    expect(getKnownDomains(sentToDomains, addressBookDomains, undefined)).toEqual(sentToDomains)
  })

  test('keeps the typed name when an Address Book name is the same', () => {
    const knownDomains = getKnownDomains(
      sentToDomains,
      { 'move.eth': CONTACT_ADDRESS },
      { [CONTACT_ADDRESS]: 9000 }
    )

    expect(knownDomains['move.eth']).toEqual(sentToDomains['move.eth'])
  })

  test('picks an Address Book name sent to more recently over an older typed name', () => {
    // mpve.eth is one char away from both move.eth (typed, sent at 1000) and mave.eth
    const knownDomains = getKnownDomains(
      sentToDomains,
      { 'mave.eth': CONTACT_ADDRESS },
      { [CONTACT_ADDRESS]: 9000 }
    )

    expect(getDomainTypoMatch('mpve.eth', TYPED_DOMAIN_ADDRESS, knownDomains)).toEqual({
      matchedDomain: 'mave.eth'
    })
  })
})

describe('getAddressBookDomains', () => {
  test('collects every name service, lowercased, and skips addresses with no names', () => {
    const domains: Domains = {
      [CONTACT_ADDRESS]: { names: { ens: ' Satoshi.ETH ', namoshi: 'satoshi.btc', gns: null } },
      [ABC_ADDRESS]: { names: {} }
    }

    expect(
      getAddressBookDomains([CONTACT_ADDRESS, ABC_ADDRESS, TYPED_DOMAIN_ADDRESS], domains)
    ).toEqual({ 'satoshi.eth': CONTACT_ADDRESS, 'satoshi.btc': CONTACT_ADDRESS })
  })
})
