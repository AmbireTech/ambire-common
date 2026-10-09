import { describe, expect, test } from '@jest/globals'

import { stringify } from '../richJson/richJson'
import { NATIVE_JSON_STORAGE_KEYS, parseStorageValue, stringifyStorageValue } from './serialization'

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
})
