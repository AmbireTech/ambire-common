import { describe, expect, test } from '@jest/globals'

import { SafeFeePayerLinks } from '../../interfaces/signAccountOp'
import { getSafeFeePayerRank, isUnlinkedSafeFeePayer } from './feePayerLinks'

const SAFE = '0x714fd9a1b6ad2da7c5bd2b2f3e0b5fb2c4dde5ce'
const OWNER = '0xe69ab4d3b7c3ed52fb3a5e4c2b9a2c0d7ad06133'
const OTHER_OWNER = '0xb0a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7c125'
const LINKED = '0x75f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7c33c'
const UNLINKED = '0xd82bc3e2a0e4f3a0b3b7ae4c5d1b2c3d4e5f3b78'

const links: SafeFeePayerLinks = {
  owners: [OWNER, OTHER_OWNER],
  linked: [LINKED],
  lastUsed: OTHER_OWNER
}

describe('getSafeFeePayerRank', () => {
  test('ranks the last payer first, then owners, then linked payers, then the rest', () => {
    expect(getSafeFeePayerRank(OTHER_OWNER, links)).toBe(0)
    expect(getSafeFeePayerRank(OWNER, links)).toBe(1)
    expect(getSafeFeePayerRank(LINKED, links)).toBe(2)
    expect(getSafeFeePayerRank(UNLINKED, links)).toBe(3)
  })

  test('ignores the casing of the payer, as payers come checksummed', () => {
    expect(getSafeFeePayerRank(OWNER.toUpperCase().replace('0X', '0x'), links)).toBe(1)
  })

  test('ranks only owners and linked payers when nothing paid for the Safe yet', () => {
    const noHistory: SafeFeePayerLinks = { owners: [OWNER], linked: [], lastUsed: null }

    expect(getSafeFeePayerRank(OWNER, noHistory)).toBe(1)
    expect(getSafeFeePayerRank(UNLINKED, noHistory)).toBe(3)
  })
})

describe('isUnlinkedSafeFeePayer', () => {
  test('is true only for an account that is neither an owner nor paid for the Safe before', () => {
    expect(isUnlinkedSafeFeePayer(UNLINKED, SAFE, links)).toBe(true)
    expect(isUnlinkedSafeFeePayer(OWNER, SAFE, links)).toBe(false)
    expect(isUnlinkedSafeFeePayer(LINKED, SAFE, links)).toBe(false)
    expect(isUnlinkedSafeFeePayer(OTHER_OWNER, SAFE, links)).toBe(false)
  })

  test('is false when the Safe pays by itself, e.g. through the gas tank', () => {
    expect(isUnlinkedSafeFeePayer(SAFE.toUpperCase().replace('0X', '0x'), SAFE, links)).toBe(false)
  })
})
