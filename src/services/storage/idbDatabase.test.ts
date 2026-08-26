import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { IDBPDatabase, openDB } from 'idb'
import { beforeEach, describe, expect, test } from '@jest/globals'

import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { AMBIRE_IDB_SCHEMA, IdbAccountOpRow } from './idbSchema'
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
    // Walks the RUNTIME manifest, so store names are values not literals — the same reason
    // reconcileSchema itself works against an unchecked view.
    const db = (await openAmbireIdb()) as unknown as IDBPDatabase
    for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
      expect(db.objectStoreNames.contains(storeDef.storeName)).toBe(true)
    }
  })

  test('creates all indexes for each store', async () => {
    const db = (await openAmbireIdb()) as unknown as IDBPDatabase
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

    // Literal store name rather than the manifest, so the row shape, the compound key and the
    // result are all checked against AmbireIdbSchema.
    const row: IdbAccountOpRow = {
      accountAddr: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      chainId: '1',
      id: 'test-op',
      timestamp: 1000,
      status: AccountOpStatus.Success,
      op: { id: 'test-op' } as SubmittedAccountOp
    }

    await db.put('accountsOps', row)
    const retrieved = await db.get('accountsOps', [
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '1',
      'test-op'
    ])
    expect(retrieved?.id).toBe('test-op')
  })
})
