import { getAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { FeePayersHistory } from '../../controllers/activity/types'
import { AccountOpStatus } from '../accountOp/types'
import { recordFeePayer, recordFeePayerOfOp } from './feePayersHistory'

const SAFE = getAddress('0x714fd9a1b6ad2da7c5bd2b2f3e0b5fb2c4dde5ce')
const PAYER = getAddress('0xe69ab4d3b7c3ed52fb3a5e4c2b9a2c0d7ad06133')
const OTHER_PAYER = getAddress('0xd82bc3e2a0e4f3a0b3b7ae4c5d1b2c3d4e5f3b78')

describe('recordFeePayer', () => {
  test('records a new payer checksummed, under the checksummed account and chain', () => {
    const history: FeePayersHistory = {}

    const hasChanged = recordFeePayer(history, SAFE.toLowerCase(), 1n, PAYER.toLowerCase(), 100)

    expect(hasChanged).toBe(true)
    expect(history).toEqual({ [SAFE]: { '1': { [PAYER]: 100 } } })
  })

  test('moves the payment time forward when the same payer pays again', () => {
    const history: FeePayersHistory = { [SAFE]: { '1': { [PAYER]: 100 } } }

    const hasChanged = recordFeePayer(history, SAFE, 1n, PAYER.toLowerCase(), 200)

    expect(hasChanged).toBe(true)
    expect(history[SAFE]!['1']).toEqual({ [PAYER]: 200 })
  })

  test('keeps the latest payment time when an older or the same payment is recorded', () => {
    const history: FeePayersHistory = { [SAFE]: { '1': { [PAYER]: 200 } } }

    expect(recordFeePayer(history, SAFE, 1n, PAYER, 100)).toBe(false)
    expect(recordFeePayer(history, SAFE, 1n, PAYER, 200)).toBe(false)
    expect(history[SAFE]!['1']).toEqual({ [PAYER]: 200 })
  })

  test('keeps payers per chain, as a payer on one chain is not linked on another', () => {
    const history: FeePayersHistory = { [SAFE]: { '1': { [PAYER]: 100 } } }

    recordFeePayer(history, SAFE, 8453n, OTHER_PAYER, 300)

    expect(history[SAFE]).toEqual({ '1': { [PAYER]: 100 }, '8453': { [OTHER_PAYER]: 300 } })
  })

  test('skips the account paying for itself, as that links no other account', () => {
    const history: FeePayersHistory = {}

    const hasChanged = recordFeePayer(history, SAFE, 1n, SAFE.toLowerCase(), 100)

    expect(hasChanged).toBe(false)
    expect(history).toEqual({})
  })

  test('skips a missing or invalid payer without throwing', () => {
    const history: FeePayersHistory = {}

    expect(recordFeePayer(history, SAFE, 1n, undefined, 100)).toBe(false)
    expect(recordFeePayer(history, SAFE, 1n, 'not-an-address', 100)).toBe(false)
    expect(recordFeePayer(history, 'not-an-address', 1n, PAYER, 100)).toBe(false)
    expect(history).toEqual({})
  })
})

describe('recordFeePayerOfOp', () => {
  // Only the fields recordFeePayerOfOp reads, stored the way the backends hand them back
  const storedOp = (
    chainId: bigint,
    timestamp: number,
    paidBy?: string,
    status?: AccountOpStatus
  ) => ({ chainId, timestamp, status, gasFeePayment: paidBy ? { paidBy } : undefined }) as any

  test('records the payer of a stored op under its chain, keeping the latest payment', () => {
    const history: FeePayersHistory = {}

    expect(recordFeePayerOfOp(history, SAFE, storedOp(1n, 300, PAYER))).toBe(true)
    expect(recordFeePayerOfOp(history, SAFE, storedOp(1n, 100, PAYER))).toBe(false)
    expect(recordFeePayerOfOp(history, SAFE, storedOp(10n, 50, PAYER.toLowerCase()))).toBe(true)
    expect(history).toEqual({ [SAFE]: { '1': { [PAYER]: 300 }, '10': { [PAYER]: 50 } } })
  })

  test('skips rejected ops, ops the account paid itself and ops without a fee payment', () => {
    const history: FeePayersHistory = {}

    expect(
      recordFeePayerOfOp(history, SAFE, storedOp(1n, 100, PAYER, AccountOpStatus.Rejected))
    ).toBe(false)
    expect(recordFeePayerOfOp(history, SAFE, storedOp(1n, 200, SAFE))).toBe(false)
    expect(recordFeePayerOfOp(history, SAFE, storedOp(1n, 300))).toBe(false)
    expect(history).toEqual({})
  })

  test('skips malformed stored ops instead of throwing', () => {
    const history: FeePayersHistory = {}
    const malformedOps = [
      null,
      undefined,
      { timestamp: 100, gasFeePayment: { paidBy: PAYER } },
      { chainId: 1n, gasFeePayment: { paidBy: PAYER } },
      { chainId: '1', timestamp: 100, gasFeePayment: { paidBy: PAYER } }
    ] as any[]

    malformedOps.forEach((op) => expect(recordFeePayerOfOp(history, SAFE, op)).toBe(false))
    expect(history).toEqual({})
  })
})
