import { describe, expect, test } from '@jest/globals'

import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { HdExternalKey, InternalKey, Pq1ExternalKey, StoredKey } from '../../interfaces/keystore'
import { getKeySeedId } from './keys'

const addr = '0x0000000000000000000000000000000000000001'

const internalKey = (meta: InternalKey['meta']): StoredKey => ({
  addr,
  type: 'internal',
  label: 'Key 1',
  dedicatedToOneSA: false,
  meta,
  privKey: 'encrypted'
})

const ledgerKey: HdExternalKey = {
  addr,
  type: 'ledger',
  label: 'Ledger Key 1',
  dedicatedToOneSA: false,
  meta: {
    deviceId: '',
    deviceModel: 'nanoX',
    hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
    index: 0,
    createdAt: null
  }
}

const pq1Key: Pq1ExternalKey = {
  addr,
  type: 'pq1',
  label: 'PQ1 Key 1',
  dedicatedToOneSA: false,
  meta: { deviceId: 'c972799008cf', deviceModel: 'pq1', index: 3, createdAt: null }
}

describe('getKeySeedId', () => {
  test('returns the seed an internal key was derived from', () => {
    expect(getKeySeedId(internalKey({ createdAt: null, fromSeedId: 'seed-1' }))).toBe('seed-1')
  })

  test('returns nothing for an internal key imported on its own (a private key)', () => {
    expect(getKeySeedId(internalKey({ createdAt: null }))).toBeUndefined()
  })

  test('returns nothing for hardware wallet keys, which never come from a saved seed', () => {
    expect(getKeySeedId({ ...ledgerKey, isExternallyStored: true })).toBeUndefined()
    expect(getKeySeedId({ ...pq1Key, isExternallyStored: true })).toBeUndefined()
  })

  test('ignores a fromSeedId smuggled into a hardware wallet key', () => {
    const ledgerKeyClaimingASeed: HdExternalKey = {
      ...ledgerKey,
      meta: { ...ledgerKey.meta, fromSeedId: 'seed-1' }
    }

    // Otherwise the key would count towards the seed's accounts and its backup status
    expect(getKeySeedId({ ...ledgerKeyClaimingASeed, privKey: null })).toBeUndefined()
  })
})
