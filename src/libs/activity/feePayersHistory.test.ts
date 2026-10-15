import { getAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { FeePayersHistory } from '../../controllers/activity/types'
import { recordFeePayer } from './feePayersHistory'

const SAFE = getAddress('0x714fd9a1b6ad2da7c5bd2b2f3e0b5fb2c4dde5ce')
const PAYER = getAddress('0xe69ab4d3b7c3ed52fb3a5e4c2b9a2c0d7ad06133')
const OTHER_PAYER = getAddress('0xd82bc3e2a0e4f3a0b3b7ae4c5d1b2c3d4e5f3b78')

describe('recordFeePayer', () => {
  test('records a new payer checksummed, under the checksummed account and chain', () => {
    const history: FeePayersHistory = {}

    const hasChanged = recordFeePayer(history, SAFE.toLowerCase(), 1n, PAYER.toLowerCase())

    expect(hasChanged).toBe(true)
    expect(history).toEqual({ [SAFE]: { '1': [PAYER] } })
  })

  test('does not duplicate a payer that differs only in casing', () => {
    const history: FeePayersHistory = { [SAFE]: { '1': [PAYER] } }

    const hasChanged = recordFeePayer(history, SAFE, 1n, PAYER.toLowerCase())

    expect(hasChanged).toBe(false)
    expect(history[SAFE]!['1']).toEqual([PAYER])
  })

  test('keeps payers per chain, as a payer on one chain is not linked on another', () => {
    const history: FeePayersHistory = { [SAFE]: { '1': [PAYER] } }

    recordFeePayer(history, SAFE, 8453n, OTHER_PAYER)

    expect(history[SAFE]).toEqual({ '1': [PAYER], '8453': [OTHER_PAYER] })
  })

  test('skips the account paying for itself, as that links no other account', () => {
    const history: FeePayersHistory = {}

    const hasChanged = recordFeePayer(history, SAFE, 1n, SAFE.toLowerCase())

    expect(hasChanged).toBe(false)
    expect(history).toEqual({})
  })

  test('skips a missing or invalid payer without throwing', () => {
    const history: FeePayersHistory = {}

    expect(recordFeePayer(history, SAFE, 1n, undefined)).toBe(false)
    expect(recordFeePayer(history, SAFE, 1n, 'not-an-address')).toBe(false)
    expect(recordFeePayer(history, 'not-an-address', 1n, PAYER)).toBe(false)
    expect(history).toEqual({})
  })
})
