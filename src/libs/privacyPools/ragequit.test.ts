import { describe, expect, test } from '@jest/globals'

import {
  POOL_RAGEQUIT_INTERFACE,
  readPrivacyPoolsDepositors,
  readPrivacyPoolsRagequit
} from './ragequit'

const DEPOSITOR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'

/** A ragequit the way the SDK encodes it, public signals `[commitment, nullifierHash, value, label]`. */
const encodeRagequit = (amount: bigint, label: bigint) =>
  POOL_RAGEQUIT_INTERFACE.encodeFunctionData('ragequit', [
    {
      pA: [1n, 2n],
      pB: [
        [3n, 4n],
        [5n, 6n]
      ],
      pC: [7n, 8n],
      pubSignals: [11n, 12n, amount, label]
    }
  ])

/** The SDK's persisted public state: deposits keyed by precommitment, numbers as hex strings. */
const storeState = (deposits: { label: bigint; depositor: string }[]) =>
  JSON.stringify({
    deposits: {
      depositsTuples: deposits.map(({ label, depositor }, i) => [
        `0x0${i + 1}`,
        {
          depositor: `0x${BigInt(depositor).toString(16)}`,
          label: `0x${label.toString(16)}`,
          value: '0x0a',
          precommitment: `0x0${i + 1}`
        }
      ])
    },
    sync: { lastSyncedBlock: '0x01' }
  })

describe('readPrivacyPoolsRagequit', () => {
  test('reads the amount and the label from the proof', () => {
    expect(readPrivacyPoolsRagequit(encodeRagequit(10n ** 18n, 42n))).toEqual({
      amount: 10n ** 18n,
      label: 42n
    })
  })

  test('is null for any other call', () => {
    expect(readPrivacyPoolsRagequit('0x')).toBeNull()
    expect(readPrivacyPoolsRagequit('0x12345678')).toBeNull()
    // The right selector with a payload cut short
    expect(readPrivacyPoolsRagequit(encodeRagequit(1n, 1n).slice(0, 74))).toBeNull()
  })
})

describe('readPrivacyPoolsDepositors', () => {
  test('finds the address each deposit was made from, checksummed', () => {
    const depositors = readPrivacyPoolsDepositors(
      storeState([
        { label: 1n, depositor: DEPOSITOR },
        { label: 2n, depositor: '0x0000000000000000000000000000000000000001' }
      ]),
      [1n, 2n]
    )

    expect(depositors.get(1n)).toBe(DEPOSITOR)
    // Leading zeros dropped by the hex encoding come back
    expect(depositors.get(2n)).toBe('0x0000000000000000000000000000000000000001')
  })

  test('reads only the deposits asked for, leaving out ones it does not find', () => {
    const depositors = readPrivacyPoolsDepositors(
      storeState([
        { label: 1n, depositor: DEPOSITOR },
        { label: 2n, depositor: DEPOSITOR }
      ]),
      [2n, 3n]
    )

    expect([...depositors.keys()]).toEqual([2n])
  })

  test('finds nothing without a stored state or labels', () => {
    expect(readPrivacyPoolsDepositors(null, [1n]).size).toBe(0)
    expect(
      readPrivacyPoolsDepositors(storeState([{ label: 1n, depositor: DEPOSITOR }]), []).size
    ).toBe(0)
  })

  test('skips entries it cannot read', () => {
    const state = JSON.stringify({
      deposits: {
        depositsTuples: [
          ['0x01', { label: '0x01' }],
          'not a tuple',
          ['0x02', { label: '0x02', depositor: `0x${BigInt(DEPOSITOR).toString(16)}` }]
        ]
      }
    })

    expect([...readPrivacyPoolsDepositors(state, [1n, 2n]).keys()]).toEqual([2n])
  })

  test('throws on a state that is not the shape it reads, rather than finding no deposits', () => {
    expect(() => readPrivacyPoolsDepositors(JSON.stringify({ sync: {} }), [1n])).toThrow(
      'privacyPools: the stored state has no deposits'
    )
    expect(() => readPrivacyPoolsDepositors('synced-1', [1n])).toThrow()
  })
})
