import { SentToHistory } from '../../controllers/activity/types'
import { getDomainTypoMatch } from './domain-typo'

const MOVE_ADDRESS = '0x1111111111111111111111111111111111111111'
const REMOVE_ADDRESS = '0x2222222222222222222222222222222222222222'
const BOB_ADDRESS = '0x3333333333333333333333333333333333333333'
const COB_ADDRESS = '0x4444444444444444444444444444444444444444'
const VITALIK_ADDRESS = '0x5555555555555555555555555555555555555555'
const TYPED_DOMAIN_ADDRESS = '0x9999999999999999999999999999999999999999'

const sentToDomains: SentToHistory['domains'] = {
  'move.eth': { address: MOVE_ADDRESS, sentAt: 1000 },
  // Newer than move.eth, so it would win any tie against it
  'remove.eth': { address: REMOVE_ADDRESS, sentAt: 5000 },
  'bob.eth': { address: BOB_ADDRESS, sentAt: 2000 },
  'cob.eth': { address: COB_ADDRESS, sentAt: 3000 },
  'vitalik.eth': { address: VITALIK_ADDRESS, sentAt: 4000 }
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
    // Both bob.eth and cob.eth are one char away from rob.eth
    expect(findMatchedDomain('rob.eth')).toBe('cob.eth')
  })

  test('returns null when the typed name was sent to before', () => {
    // bob.eth is one char away from cob.eth, but the user knows bob.eth already
    expect(findMatchedDomain('bob.eth')).toBeNull()
    expect(findMatchedDomain(' BOB.eth')).toBeNull()
  })

  test('skips a known name that points to the same address as the typed one', () => {
    expect(findMatchedDomain('mpve.eth', MOVE_ADDRESS)).toBeNull()
  })

  test('falls back to another match when the newest one points to the same address', () => {
    expect(findMatchedDomain('rob.eth', COB_ADDRESS)).toBe('bob.eth')
  })

  test('returns null for an empty name or no history', () => {
    expect(findMatchedDomain('  ')).toBeNull()
    expect(getDomainTypoMatch('mpve.eth', TYPED_DOMAIN_ADDRESS, {})).toBeNull()
  })
})
