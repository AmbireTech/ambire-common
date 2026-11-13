import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { StorageController } from '../../controllers/storage/storage'
import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import {
  createKohakuKeystore,
  createKohakuNetwork,
  createKohakuProvider,
  createKohakuStorage
} from './host'

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

describe('createKohakuNetwork', () => {
  const READ_TIMEOUT = 1_000
  const ASP_URL = 'https://api.0xbow.io/1/public/mt-leaves'

  /** A server that accepts the connection and never answers. */
  const createSilentFetch = () => jest.fn(() => new Promise<never>(() => {})) as unknown as Fetch

  afterEach(() => jest.useRealTimers())

  test('fails a GET that gets no answer', async () => {
    jest.useFakeTimers()
    const network = createKohakuNetwork(createSilentFetch(), READ_TIMEOUT)

    const reading = network.fetch(ASP_URL, { method: 'GET' })
    jest.advanceTimersByTime(READ_TIMEOUT)

    await expect(reading).rejects.toThrow('request-timeout')
  })

  test('keeps waiting on a POST, which may be a broadcast still on its way', async () => {
    jest.useFakeTimers()
    const network = createKohakuNetwork(createSilentFetch(), READ_TIMEOUT)

    const settled = jest.fn()
    network.fetch('https://relayer.example/request', { method: 'POST' }).then(settled, settled)
    jest.advanceTimersByTime(READ_TIMEOUT * 10)
    await Promise.resolve()

    expect(settled).not.toHaveBeenCalled()
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

describe('createKohakuStorage', () => {
  const OBSOLETE_KEY = 'privacy-pool-state-1-123'
  const CURRENT_KEY = 'privacy-pool-state-v2-1-123'

  const prepareStorage = async (blob: Record<string, string>) => {
    const storage = new StorageController(produceMemoryStore())
    await storage.set('privacyPoolsState', blob)
    const onError = jest.fn()
    const kohakuStorage = createKohakuStorage({
      storage,
      storageKey: 'privacyPoolsState',
      isObsoleteKey: (key) => key === OBSOLETE_KEY,
      onError
    })

    return { storage, kohakuStorage, onError }
  }

  /** The removal is written after the read that triggered it. */
  const readStoredBlob = async (storage: StorageController) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    return storage.get('privacyPoolsState', {})
  }

  test('removes the obsolete keys from storage on the first read, keeping the others', async () => {
    const { storage, kohakuStorage, onError } = await prepareStorage({
      [OBSOLETE_KEY]: 'old state',
      [CURRENT_KEY]: 'new state'
    })

    expect(await kohakuStorage.get(CURRENT_KEY)).toBe('new state')
    expect(await kohakuStorage.get(OBSOLETE_KEY)).toBeNull()
    expect(await readStoredBlob(storage)).toEqual({ [CURRENT_KEY]: 'new state' })
    expect(onError).not.toHaveBeenCalled()
  })

  test('removes the obsolete keys when the first call is a write', async () => {
    const { storage, kohakuStorage } = await prepareStorage({ [OBSOLETE_KEY]: 'old state' })

    await kohakuStorage.set(CURRENT_KEY, 'new state')

    expect(await readStoredBlob(storage)).toEqual({ [CURRENT_KEY]: 'new state' })
  })

  test('writes nothing when no obsolete key is stored', async () => {
    const { storage, kohakuStorage } = await prepareStorage({ [CURRENT_KEY]: 'new state' })
    const set = jest.spyOn(storage, 'set')

    expect(await kohakuStorage.get(CURRENT_KEY)).toBe('new state')
    await readStoredBlob(storage)

    expect(set).not.toHaveBeenCalled()
  })

  test('reports a failed removal and keeps serving the current keys', async () => {
    const { storage, kohakuStorage, onError } = await prepareStorage({
      [OBSOLETE_KEY]: 'old state',
      [CURRENT_KEY]: 'new state'
    })
    jest.spyOn(storage, 'set').mockRejectedValueOnce(new Error('storage: quota exceeded'))

    expect(await kohakuStorage.get(CURRENT_KEY)).toBe('new state')
    await readStoredBlob(storage)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'storage: quota exceeded' }),
      expect.any(String)
    )
  })
})
