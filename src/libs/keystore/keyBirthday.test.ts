import { expect } from '@jest/globals'

import { StoredKey } from '@/interfaces/keystore'

import { backfillKeyBirthdays } from './keyBirthday'

const NOW = 1_700_000_000_000
const LAST_YEAR = NOW - 365 * 24 * 60 * 60 * 1000

const internalKey = (meta: Partial<StoredKey['meta']> = {}): StoredKey =>
  ({
    addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    type: 'internal',
    label: 'Key 1',
    dedicatedToOneSA: false,
    privKey: {} as any,
    meta: { createdAt: null, ...meta }
  }) as StoredKey

const externalKey = (): StoredKey =>
  ({
    addr: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
    type: 'ledger',
    label: 'Ledger 1',
    dedicatedToOneSA: false,
    privKey: null,
    meta: {
      createdAt: null,
      deviceId: 'a',
      deviceModel: 'b',
      hdPathTemplate: "m/44'/60'/0'/0/<account>",
      index: 0
    }
  }) as unknown as StoredKey

describe('libs/keystore/keyBirthday', () => {
  it('dates an undated internal key to today and marks the date as assumed', () => {
    const { keys, hasBackfilled } = backfillKeyBirthdays([internalKey()], NOW)

    expect(hasBackfilled).toBe(true)
    expect(keys[0].meta.createdAt).toBe(NOW)
    expect(keys[0].meta.hasNoPriorHistory).toBe(true)
    expect(keys[0].meta.isBirthdayAssumed).toBe(true)
  })

  it('keeps an existing createdAt, which is the earlier and therefore safer birthday', () => {
    const { keys } = backfillKeyBirthdays([internalKey({ createdAt: LAST_YEAR })], NOW)

    expect(keys[0].meta.createdAt).toBe(LAST_YEAR)
    expect(keys[0].meta.hasNoPriorHistory).toBe(true)
  })

  it('leaves a provable birthday alone and does not mark it assumed', () => {
    const key = internalKey({ createdAt: LAST_YEAR, hasNoPriorHistory: true })
    const { keys, hasBackfilled } = backfillKeyBirthdays([key], NOW)

    expect(hasBackfilled).toBe(false)
    expect(keys[0]).toBe(key)
    expect(keys[0].meta.isBirthdayAssumed).toBeUndefined()
  })

  it('never overrides a key already known to have an unknown age', () => {
    const key = internalKey({ createdAt: LAST_YEAR, hasNoPriorHistory: false })
    const { keys, hasBackfilled } = backfillKeyBirthdays([key], NOW)

    expect(hasBackfilled).toBe(false)
    expect(keys[0].meta.hasNoPriorHistory).toBe(false)
  })

  it('does not date hardware keys, which are not derived from a phrase we could date', () => {
    const { keys, hasBackfilled } = backfillKeyBirthdays([externalKey()], NOW)

    expect(hasBackfilled).toBe(false)
    expect(keys[0].meta.hasNoPriorHistory).toBeUndefined()
  })

  it('reports nothing to do for an empty keystore, so no write is triggered', () => {
    expect(backfillKeyBirthdays([], NOW).hasBackfilled).toBe(false)
  })

  it('is idempotent, so a second startup assumes nothing new', () => {
    const once = backfillKeyBirthdays([internalKey()], NOW)
    const twice = backfillKeyBirthdays(once.keys, NOW + 86_400_000)

    expect(twice.hasBackfilled).toBe(false)
    expect(twice.keys[0].meta.createdAt).toBe(NOW)
  })

  it('leaves the input untouched, since the caller still holds the stored array', () => {
    const key = internalKey()
    const { keys } = backfillKeyBirthdays([key], NOW)

    expect(key.meta.hasNoPriorHistory).toBeUndefined()
    expect(keys[0]).not.toBe(key)
  })
})
