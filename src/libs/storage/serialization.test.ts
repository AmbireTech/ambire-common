import { describe, expect, test } from '@jest/globals'

import { stringify } from '../richJson/richJson'
import {
  NATIVE_JSON_STORAGE_KEYS,
  NativeJsonStorageKey,
  parseStorageValue,
  stringifyStorageValue
} from './serialization'

const phishing = { version: 3, updatedAt: 1, domains: ['a.com'], addresses: ['0xabc'] }

describe('storage serialization', () => {
  test('the phishing list skips richJson', () => {
    expect(NATIVE_JSON_STORAGE_KEYS.has('phishing')).toBe(true)
    expect(stringifyStorageValue('phishing', phishing)).toBe(JSON.stringify(phishing))
  })

  test('the phishing list written by richJson before is still read the same', () => {
    expect(parseStorageValue('phishing', stringify(phishing))).toEqual(phishing)
  })

  test('other keys keep richJson, so BigInts and Errors survive the round trip', () => {
    const value = { amount: 10n, error: new Error('boom') }
    const parsed = parseStorageValue('accountsOps', stringifyStorageValue('accountsOps', value))

    expect(parsed.amount).toBe(10n)
    expect(parsed.error).toBeInstanceOf(Error)
    expect(parsed.error.message).toBe('boom')
  })

  test('a BigInt under a native-JSON key fails loudly instead of being stored wrong', () => {
    expect(() => stringifyStorageValue('phishing', { version: 1n })).toThrow()
  })

  test('the dApps catalog skips richJson and round-trips', () => {
    const dapps = [
      { id: 'app.uniswap.org', name: 'Uniswap', url: 'https://app.uniswap.org', icon: null }
    ]

    expect(NATIVE_JSON_STORAGE_KEYS.has('dappsV2')).toBe(true)
    expect(stringifyStorageValue('dappsV2', dapps)).toBe(JSON.stringify(dapps))
    expect(parseStorageValue('dappsV2', stringifyStorageValue('dappsV2', dapps))).toEqual(dapps)
  })

  test('keys whose values can hold a BigInt or an Error are rejected at compile time', () => {
    // Checked by the type-check, not at runtime: each assignment fails to compile without the
    // directive above it
    // @ts-expect-error accountsOps holds BigInts (e.g. the nonce of a submitted op)
    const accountsOpsKey: NativeJsonStorageKey<'accountsOps'> = 'accountsOps'
    // @ts-expect-error networks hold BigInts (the chainId)
    const networksKey: NativeJsonStorageKey<'networks'> = 'networks'
    const phishingKey: NativeJsonStorageKey<'phishing'> = 'phishing'
    const dappsKey: NativeJsonStorageKey<'dappsV2'> = 'dappsV2'

    expect([accountsOpsKey, networksKey, phishingKey, dappsKey]).toHaveLength(4)
  })
})
