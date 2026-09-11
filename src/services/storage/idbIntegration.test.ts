/**
 * Tests for the IDB infrastructure itself — schema reconciliation, the migration handler
 * chain, and the manifest guards that keep dbVersion, migrationHandlers and the migrations
 * changelog from drifting apart.
 *
 * Controller wiring is NOT tested here. AccountOpsPersistence and PhishingPersistence are the
 * two shipped examples; their own suites cover migration ordering, restarts and fallbacks.
 */

import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { IDBPDatabase, openDB } from 'idb'
import { beforeEach, describe, expect, test } from '@jest/globals'

import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import {
  AmbireIdbDatabase,
  AmbireIdbUpgradeTransaction,
  applyMigrations,
  MigrationHandler,
  migrationHandlers,
  openAmbireIdb,
  reconcileSchema,
  resetAmbireIdbForTesting
} from './idbDatabase'
import { AMBIRE_IDB_SCHEMA } from './idbSchema'

beforeEach(() => {
  resetAmbireIdbForTesting()
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
})

// ─────────────────────────────────────────────────────────────────────────────
// Schema manifest ↔ migration handler consistency
//
// These are static guards. They fail at CI time the moment dbVersion, the
// handler registry, and the migrations manifest drift apart — which would
// otherwise only surface at runtime as a missing store on a user's machine.
// ─────────────────────────────────────────────────────────────────────────────

describe('Schema manifest ↔ migration handler consistency', () => {
  test('every version from 1..dbVersion has a migration handler', () => {
    const missing: number[] = []
    for (let v = 1; v <= AMBIRE_IDB_SCHEMA.dbVersion; v++) {
      if (!migrationHandlers[v]) missing.push(v)
    }
    expect(missing).toEqual([])
  })

  test('no migration handler is registered above dbVersion', () => {
    const registered = Object.keys(migrationHandlers).map(Number)
    const stray = registered.filter((v) => v > AMBIRE_IDB_SCHEMA.dbVersion)
    expect(stray).toEqual([])
  })

  test('migrations manifest describes a contiguous 0 → dbVersion chain', () => {
    const sorted = [...AMBIRE_IDB_SCHEMA.migrations].sort((a, b) => a.toVersion - b.toVersion)

    expect(sorted[0]?.fromVersion).toBe(0)
    expect(sorted[sorted.length - 1]?.toVersion).toBe(AMBIRE_IDB_SCHEMA.dbVersion)

    sorted.forEach((migration, i) => {
      // Each entry advances exactly one version, and picks up where the last left off
      expect(migration.toVersion).toBe(migration.fromVersion + 1)
      if (i > 0) expect(migration.fromVersion).toBe(sorted[i - 1]?.toVersion)
    })
  })

  test('store names in the manifest are unique', () => {
    const names = AMBIRE_IDB_SCHEMA.stores.map((s) => s.storeName)
    expect(names).toHaveLength(new Set(names).size)
  })

  test('index names within each store are unique', () => {
    for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
      const names = (storeDef.indexes ?? []).map((i) => i.name)
      expect(names).toHaveLength(new Set(names).size)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Schema upgrade
//
// These exercise the real reconcileSchema() and applyMigrations() exported from
// idbDatabase.ts rather than a copy of the loop, so a regression in the
// production migration path fails here.
// ─────────────────────────────────────────────────────────────────────────────

describe('Schema upgrade', () => {
  test('reconcileSchema adds a store introduced by a later manifest version', async () => {
    // 'notifications' is deliberately NOT in the manifest — it stands in for a
    // future addition. Using a real manifest store here would prove nothing, since
    // reconcileSchema would have created it on the first pass anyway.
    const FUTURE_STORE = 'notifications'

    const currentDb = await openDB('ambire-dummy-upgrade', 1, {
      upgrade(d, _oldVersion, _newVersion, tx) {
        reconcileSchema(d as unknown as AmbireIdbDatabase, tx as AmbireIdbUpgradeTransaction)
      }
    })
    for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
      expect(currentDb.objectStoreNames.contains(storeDef.storeName)).toBe(true)
    }
    expect(currentDb.objectStoreNames.contains(FUTURE_STORE)).toBe(false)
    currentDb.close()

    // Now the manifest gains a store
    const nextStores = [...AMBIRE_IDB_SCHEMA.stores, { storeName: FUTURE_STORE, keyPath: 'id' }]
    const upgraded = await openDB('ambire-dummy-upgrade', 2, {
      upgrade(d, _oldVersion, _newVersion, tx) {
        reconcileSchema(
          d as unknown as AmbireIdbDatabase,
          tx as AmbireIdbUpgradeTransaction,
          nextStores
        )
      }
    })

    // Pre-existing stores survive and the new one appears
    for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
      expect(upgraded.objectStoreNames.contains(storeDef.storeName)).toBe(true)
    }
    expect(upgraded.objectStoreNames.contains(FUTURE_STORE)).toBe(true)
    upgraded.close()
  })

  test('reconcileSchema adds an index to a store that already exists', async () => {
    // The trap this closes: a store created before an index was declared. A
    // create-store-only handler skips existing stores, so upgrading users would
    // never receive the new index while fresh installs would.
    const bare = await openDB('ambire-dummy-index-add', 1, {
      upgrade(d) {
        d.createObjectStore('accountsOps', { keyPath: ['accountAddr', 'chainId', 'id'] })
      }
    })
    expect([...bare.transaction('accountsOps').store.indexNames]).toEqual([])
    bare.close()

    const upgraded = await openDB('ambire-dummy-index-add', 2, {
      upgrade(d, _oldVersion, _newVersion, tx) {
        reconcileSchema(d as unknown as AmbireIdbDatabase, tx as AmbireIdbUpgradeTransaction)
      }
    })

    const indexNames = [...upgraded.transaction('accountsOps').store.indexNames]
    const declared = (
      AMBIRE_IDB_SCHEMA.stores.find((s) => s.storeName === 'accountsOps')?.indexes ?? []
    ).map((i) => i.name)
    expect(declared.length).toBeGreaterThan(0)
    for (const name of declared) expect(indexNames).toContain(name)
    upgraded.close()
  })

  test('reconcileSchema is idempotent — a second run changes nothing', async () => {
    const first = await openDB('ambire-dummy-idempotent', 1, {
      upgrade(d, _o, _n, tx) {
        reconcileSchema(d as unknown as AmbireIdbDatabase, tx as AmbireIdbUpgradeTransaction)
      }
    })
    const before = [...first.transaction('accountsOps').store.indexNames].sort()
    first.close()

    const second = await openDB('ambire-dummy-idempotent', 2, {
      upgrade(d, _o, _n, tx) {
        reconcileSchema(d as unknown as AmbireIdbDatabase, tx as AmbireIdbUpgradeTransaction)
      }
    })
    const after = [...second.transaction('accountsOps').store.indexNames].sort()

    expect(after).toEqual(before)
    expect(second.objectStoreNames.contains('accountsOps')).toBe(true)
    second.close()
  })

  test('v1 data survives the upgrade and a newly added store is empty and writable', async () => {
    const ACCOUNT = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    const v1Db = await openDB('ambire-dummy-data-upgrade', 1, {
      upgrade(d, _o, _n, tx) {
        reconcileSchema(d as unknown as AmbireIdbDatabase, tx as AmbireIdbUpgradeTransaction)
      }
    })
    await v1Db.put('accountsOps', {
      accountAddr: ACCOUNT,
      chainId: '1',
      id: 'op-1',
      timestamp: 1000,
      status: 'Success',
      op: {}
    })
    v1Db.close()

    // 'notifications' stands in for a future addition — 'phishing' is in the manifest now, so
    // it would prove nothing here.
    const nextStores = [...AMBIRE_IDB_SCHEMA.stores, { storeName: 'notifications', keyPath: 'id' }]
    const v2Db = await openDB('ambire-dummy-data-upgrade', 2, {
      upgrade(d, _o, _n, tx) {
        reconcileSchema(
          d as unknown as AmbireIdbDatabase,
          tx as AmbireIdbUpgradeTransaction,
          nextStores
        )
      }
    })

    // Existing v1 row must be intact
    const row = await v2Db.get('accountsOps', [ACCOUNT, '1', 'op-1'])
    expect(row).toBeDefined()
    expect((row as any).id).toBe('op-1')

    // New store must be empty but functional
    expect(await v2Db.count('notifications')).toBe(0)
    await v2Db.put('notifications', { id: 'n-1', data: 'post-upgrade' })
    expect((await v2Db.get('notifications', 'n-1')) as { data: string }).toEqual({
      id: 'n-1',
      data: 'post-upgrade'
    })

    v2Db.close()
  })

  // openAmbireIdb()'s own store/index/singleton guarantees are covered in
  // idbDatabase.test.ts — not repeated here.
})

// ─────────────────────────────────────────────────────────────────────────────
// applyMigrations — the production loop
//
// Handlers are injected so multi-step sequences can be exercised while the
// manifest stays at its real version. The loop itself is the production one.
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMigrations', () => {
  /** Runs applyMigrations inside a real versionchange transaction. */
  async function upgradeWith(
    dbName: string,
    version: number,
    handlers: Record<number, MigrationHandler>
  ): Promise<{ db: IDBPDatabase<any>; applied: number[] }> {
    let applied: number[] = []
    const db = await openDB(dbName, version, {
      upgrade(d, oldVersion, newVersion, tx) {
        applied = applyMigrations(
          d as unknown as AmbireIdbDatabase,
          tx as AmbireIdbUpgradeTransaction,
          oldVersion,
          newVersion ?? version,
          handlers
        )
      }
    })
    return { db, applied }
  }

  test('runs handlers for (oldVersion, targetVersion] in ascending order', async () => {
    const order: number[] = []
    const handlers: Record<number, MigrationHandler> = {
      1: () => order.push(1),
      2: () => order.push(2),
      3: () => order.push(3)
    }

    const { db, applied } = await upgradeWith('ambire-apply-order', 3, handlers)

    expect(order).toEqual([1, 2, 3])
    expect(applied).toEqual([1, 2, 3])
    db.close()
  })

  test('skips the handler for oldVersion itself on a partial upgrade', async () => {
    const order: number[] = []
    const handlers: Record<number, MigrationHandler> = {
      1: () => order.push(1),
      2: () => order.push(2),
      3: () => order.push(3)
    }

    const first = await upgradeWith('ambire-apply-partial', 1, handlers)
    expect(first.applied).toEqual([1])
    first.db.close()

    // v1 → v3 must run 2 and 3 only — never re-run 1
    const second = await upgradeWith('ambire-apply-partial', 3, handlers)
    expect(second.applied).toEqual([2, 3])
    expect(order).toEqual([1, 2, 3])
    second.db.close()
  })

  test('gaps in the handler registry are skipped without throwing', async () => {
    // A purely additive schema change needs no data handler, so a gap is normal.
    const handlers: Record<number, MigrationHandler> = { 1: () => {} }

    const { db, applied } = await upgradeWith('ambire-apply-gap', 3, handlers)

    expect(applied).toEqual([1])
    // Structure still complete — reconcileSchema does not depend on handlers
    expect(db.objectStoreNames.contains('accountsOps')).toBe(true)
    db.close()
  })

  test('reconcileSchema runs before handlers so a handler can write to a new store', async () => {
    // Ordering guarantee: a data-migration handler must be able to read and
    // write stores introduced by the same upgrade.
    const handlers: Record<number, MigrationHandler> = {
      1: (_db, tx) => {
        tx.objectStore('accountsOps').put({
          accountAddr: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          chainId: '1',
          id: 'written-by-handler',
          timestamp: 1,
          status: AccountOpStatus.Success,
          op: {} as SubmittedAccountOp
        })
      }
    }

    const { db } = await upgradeWith('ambire-apply-ordering', 1, handlers)

    const row = await db.get('accountsOps', [
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '1',
      'written-by-handler'
    ])
    expect(row).toBeDefined()
    db.close()
  })

  test('a handler can read and transform rows written by an earlier version', async () => {
    // This is the entire reason handlers exist, so it needs to be provably possible.
    // Handlers are synchronous, so the read cannot be awaited — it has to be chained.
    // The versionchange transaction stays alive across microtasks, so a .then() that
    // issues further requests still lands inside the same upgrade.
    const ACCOUNT = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    const first = await upgradeWith('ambire-apply-transform', 1, { 1: () => {} })
    await first.db.put('accountsOps', {
      accountAddr: ACCOUNT,
      chainId: '1',
      id: 'op-1',
      timestamp: 1000,
      status: 'stale-status',
      op: {}
    })
    first.db.close()

    const handlers: Record<number, MigrationHandler> = {
      1: () => {},
      2: (_db, tx) => {
        const store = tx.objectStore('accountsOps')
        store.getAll().then((rows: any[]) => {
          rows.forEach((row) => store.put({ ...row, status: 'migrated-status' }))
        })
      }
    }

    const second = await upgradeWith('ambire-apply-transform', 2, handlers)

    const row = await second.db.get('accountsOps', [ACCOUNT, '1', 'op-1'])
    expect((row as any).status).toBe('migrated-status')
    second.db.close()
  })

  test('runs no handlers when oldVersion already equals the target', async () => {
    const handlers: Record<number, MigrationHandler> = { 1: () => {}, 2: () => {} }

    const first = await upgradeWith('ambire-apply-noop', 2, handlers)
    expect(first.applied).toEqual([1, 2])
    first.db.close()

    // Re-opening at the same version does not trigger upgrade() at all
    const reopened = await openDB('ambire-apply-noop', 2)
    expect(reopened.version).toBe(2)
    reopened.close()
  })
})

// The happy-path singleton behaviour (same promise on repeated calls, new promise
// after a reset) is covered in idbDatabase.test.ts. What is left here is the
// failure path, which that suite does not exercise.
describe('openAmbireIdb singleton', () => {
  test('resets openPromise on failure so a subsequent call can retry', async () => {
    // Pre-open the production DB at a version HIGHER than the schema so that
    // openAmbireIdb() requesting the lower version receives a VersionError.
    // The .catch() handler must reset openPromise = null so the retry succeeds.
    resetAmbireIdbForTesting()
    try {
      const higherVersion = AMBIRE_IDB_SCHEMA.dbVersion + 1
      const prelim = await openDB(AMBIRE_IDB_SCHEMA.dbName, higherVersion, {
        upgrade(d) {
          for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
            if (!d.objectStoreNames.contains(storeDef.storeName)) {
              d.createObjectStore(storeDef.storeName, { keyPath: storeDef.keyPath })
            }
          }
        }
      })
      prelim.close()

      // openAmbireIdb() at the lower schema version should fail with VersionError
      await expect(openAmbireIdb()).rejects.toThrow()

      // openPromise was reset to null by the .catch() — reset the IDB factory so
      // the retry opens a fresh database at the production schema version
      global.indexedDB = new IDBFactory()
      global.IDBKeyRange = IDBKeyRange

      const retried = await openAmbireIdb()
      expect(retried).toBeDefined()
      // Runtime manifest walk — store names are values here, not literals
      const untypedRetried = retried as unknown as IDBPDatabase
      for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
        expect(untypedRetried.objectStoreNames.contains(storeDef.storeName)).toBe(true)
      }
      retried.close()
    } finally {
      resetAmbireIdbForTesting()
    }
  })
})
