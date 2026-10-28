import { describe, expect, jest, test } from '@jest/globals'

import { Hex } from '../../interfaces/hex'
import { createKohakuKeystore, createKohakuMemoryStorage, createKohakuProvider } from './host'

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

describe('createKohakuProvider', () => {
  const TX_HASH = `0x${'ab'.repeat(32)}`
  const LOG = {
    blockNumber: 22_153_713,
    topics: [`0x${'01'.repeat(32)}`],
    data: '0x',
    address: '0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB',
    index: 7,
    transactionHash: TX_HASH
  }

  test("keeps each log's position and transaction hash, which the history links to", async () => {
    const provider = { getLogs: jest.fn(async () => [LOG]) }
    const kohakuProvider = createKohakuProvider(provider as any)

    expect(await kohakuProvider.getLogs({ address: LOG.address as Hex, fromBlock: 1n })).toEqual([
      {
        blockNumber: 22_153_713n,
        topics: LOG.topics,
        data: '0x',
        address: LOG.address,
        logIndex: 7,
        transactionHash: TX_HASH
      }
    ])
  })

  test("keeps the transaction hash of a receipt's logs", async () => {
    const provider = {
      getTransactionReceipt: jest.fn(async () => ({
        blockNumber: LOG.blockNumber,
        status: 1,
        gasUsed: 21_000n,
        logs: [LOG]
      }))
    }
    const receipt = await createKohakuProvider(provider as any).getTransactionReceipt(TX_HASH)

    expect(receipt?.logs[0]).toMatchObject({ logIndex: 7, transactionHash: TX_HASH })
  })

  test('reports no receipt for a transaction not yet mined', async () => {
    const provider = { getTransactionReceipt: jest.fn(async () => null) }

    expect(await createKohakuProvider(provider as any).getTransactionReceipt(TX_HASH)).toBeNull()
  })
})

describe('createKohakuMemoryStorage', () => {
  test('keeps what is saved, apart per instance', async () => {
    const storage = createKohakuMemoryStorage()
    const other = createKohakuMemoryStorage()

    expect(await storage.get('key')).toBeNull()
    await storage.set('key', 'first')
    await storage.set('key', 'second')

    expect(await storage.get('key')).toBe('second')
    expect(await other.get('key')).toBeNull()
  })
})
