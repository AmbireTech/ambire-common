import { describe, expect, jest, test } from '@jest/globals'

import { Hex } from '../../interfaces/hex'
import { createKohakuKeystore } from './host'

const SIGNING_KEY_PATH = "m/28784'/1'/0'"
const KEY: Hex = `0x${'11'.repeat(32)}`

describe('createKohakuKeystore', () => {
  test('derives a key once and serves it from the cache afterwards', async () => {
    const deriveKey = jest.fn(async () => KEY)
    const keystore = createKohakuKeystore(deriveKey)

    expect(await keystore.deriveAt(SIGNING_KEY_PATH)).toBe(KEY)
    expect(await keystore.deriveAt(SIGNING_KEY_PATH)).toBe(KEY)
    expect(deriveKey).toHaveBeenCalledTimes(1)
    expect(deriveKey).toHaveBeenCalledWith(SIGNING_KEY_PATH)
  })

  test('shares one derivation between concurrent calls', async () => {
    let resolveKey!: (key: Hex) => void
    const deriveKey = jest.fn(
      () =>
        new Promise<Hex>((resolve) => {
          resolveKey = resolve
        })
    )
    const keystore = createKohakuKeystore(deriveKey)

    const first = keystore.deriveAt(SIGNING_KEY_PATH)
    const second = keystore.deriveAt(SIGNING_KEY_PATH)
    resolveKey(KEY)

    expect(await Promise.all([first, second])).toEqual([KEY, KEY])
    expect(deriveKey).toHaveBeenCalledTimes(1)
  })

  test('does not cache a failed derivation, so the next call retries', async () => {
    const deriveKey = jest
      .fn<(path: string) => Promise<Hex>>()
      .mockRejectedValueOnce(new Error('keystore: not unlocked'))
      .mockResolvedValueOnce(KEY)
    const keystore = createKohakuKeystore(deriveKey)

    await expect(keystore.deriveAt(SIGNING_KEY_PATH)).rejects.toThrow('keystore: not unlocked')
    expect(await keystore.deriveAt(SIGNING_KEY_PATH)).toBe(KEY)
    expect(deriveKey).toHaveBeenCalledTimes(2)
  })

  test('keeps each path apart, and the cache apart per instance', async () => {
    const otherKey: Hex = `0x${'22'.repeat(32)}`
    const deriveKey = jest.fn(async (path: string) => (path === SIGNING_KEY_PATH ? KEY : otherKey))
    const keystore = createKohakuKeystore(deriveKey)

    expect(await keystore.deriveAt(SIGNING_KEY_PATH)).toBe(KEY)
    expect(await keystore.deriveAt("m/28784'/1'/1'")).toBe(otherKey)
    // A new instance, as after a lock, derives again
    expect(await createKohakuKeystore(deriveKey).deriveAt(SIGNING_KEY_PATH)).toBe(KEY)
    expect(deriveKey).toHaveBeenCalledTimes(3)
  })
})
