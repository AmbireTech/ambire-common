import { describe, expect, test } from '@jest/globals'

import { POOL_RAGEQUIT_INTERFACE, readPrivacyPoolsRagequit } from './ragequit'

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
