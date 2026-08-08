import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, describe, expect, test } from '@jest/globals'

import { AMBIRE_IDB_SCHEMA } from './idbSchema'
import { openAmbireIdb, resetAmbireIdbForTesting } from './idbDatabase'

beforeEach(() => {
  resetAmbireIdbForTesting()
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
})

describe('openAmbireIdb', () => {
  test('opens the database at the version declared in the schema', async () => {
    const db = await openAmbireIdb()
    expect(db.version).toBe(AMBIRE_IDB_SCHEMA.dbVersion)
  })

  test('creates all stores declared in the schema', async () => {
    const db = await openAmbireIdb()
    for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
      expect(db.objectStoreNames.contains(storeDef.storeName)).toBe(true)
    }
  })

  test('creates all indexes for each store', async () => {
    const db = await openAmbireIdb()
    for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
      const tx = db.transaction(storeDef.storeName, 'readonly')
      const store = tx.objectStore(storeDef.storeName)
      for (const idx of storeDef.indexes ?? []) {
        expect(store.indexNames.contains(idx.name)).toBe(true)
      }
      await tx.done
    }
  })

  test('returns the same promise on repeated calls (singleton)', async () => {
    const p1 = openAmbireIdb()
    const p2 = openAmbireIdb()
    expect(p1).toBe(p2)
    await p1
  })

  test('returns a new promise after resetAmbireIdbForTesting', async () => {
    const p1 = openAmbireIdb()
    await p1
    resetAmbireIdbForTesting()
    global.indexedDB = new IDBFactory()
    const p2 = openAmbireIdb()
    expect(p1).not.toBe(p2)
    await p2
  })

  test('blocking() closes this connection so another context can upgrade', async () => {
    // Regression guard: the handler used to drop the cached promise without ever
    // calling db.close(), so an upgrade from a newer app version stayed blocked
    // indefinitely and the user had to reload by hand.
    const held = await openAmbireIdb()
    expect(held.version).toBe(AMBIRE_IDB_SCHEMA.dbVersion)

    // Another context opens the same database at a higher version. This can only
    // complete if the connection above yields.
    const upgraded = await openDB(AMBIRE_IDB_SCHEMA.dbName, AMBIRE_IDB_SCHEMA.dbVersion + 1)

    expect(upgraded.version).toBe(AMBIRE_IDB_SCHEMA.dbVersion + 1)
    upgraded.close()
  })

  test('a fresh install ends up with every store in the manifest', async () => {
    // Structure comes from reconcileSchema(), which runs before the versioned
    // migration handlers — the handlers themselves only transform existing rows.
    const db = await openAmbireIdb()
    const storeNames = Array.from(db.objectStoreNames)
    for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
      expect(storeNames).toContain(storeDef.storeName)
    }
  })

  test('database is readable and writable after init', async () => {
    const db = await openAmbireIdb()
    const storeName = AMBIRE_IDB_SCHEMA.stores[0]!.storeName

    const row = {
      accountAddr: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chainId: '1',
      id: 'test-op',
      timestamp: 1000,
      status: 0,
      op: { id: 'test-op' }
    }

    await db.put(storeName, row)
    const retrieved = await db.get(storeName, [
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '1',
      'test-op'
    ])
    expect(retrieved).toBeDefined()
    expect((retrieved as typeof row).id).toBe('test-op')
  })
})
