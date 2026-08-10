/**
 * IDB integration tests using a self-contained dummy controller.
 *
 * Purpose: verify the infrastructure pattern — not phishing-specific logic.
 *   - Dynamic path: IDB is available (extension / web)
 *   - Static path:  IDB is not available (mobile / key-value fallback)
 *   - Schema upgrade: v1 → v2 runs the migration handler without data loss
 *
 * The DummyController defined below is the canonical template for wiring a
 * new controller to IDB. It mirrors the three steps every controller's #load()
 * must follow:
 *   1. await backend.ensureMigrated(...)  ← migration before any read
 *   2. this.state = await backend.loadSnapshot()
 *   3. mutations call backend.saveSnapshot(newState)
 */

import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, describe, expect, jest, test } from '@jest/globals'

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

// ─────────────────────────────────────────────────────────────────────────────
// Dummy backend interface + implementations
//
// These mirror the IActivityOpsBackend / IPhishingOpsBackend pattern but with
// a minimal generic payload so the tests stay focused on the lifecycle, not
// domain logic.
// ─────────────────────────────────────────────────────────────────────────────

interface DummyState {
  version: number
  data: string
}

const DEFAULT_DUMMY_STATE: DummyState = { version: 0, data: '' }
// Reuses the 'phishing' store name, but inside the isolated test DB created below —
// these tests never touch the production database.
const DUMMY_STORE = 'phishing'
const DUMMY_KEY = 'dummy-snapshot'

interface IDummyBackend {
  isEmpty(): Promise<boolean>
  migrateFromStorage(state: DummyState): Promise<void>
  ensureMigrated(
    getLegacy: () => Promise<DummyState>,
    removeLegacy: () => Promise<void>
  ): Promise<void>
  load(): Promise<DummyState>
  save(state: DummyState): Promise<void>
}

/** IDB-backed backend — used in web/extension environments. */
class DummyIdbBackend implements IDummyBackend {
  #db: AmbireIdbDatabase

  constructor(db: AmbireIdbDatabase) {
    this.#db = db
  }

  async isEmpty(): Promise<boolean> {
    return (await this.#db.count(DUMMY_STORE)) === 0
  }

  async migrateFromStorage(state: DummyState): Promise<void> {
    await this.save(state)
  }

  async ensureMigrated(
    getLegacy: () => Promise<DummyState>,
    removeLegacy: () => Promise<void>
  ): Promise<void> {
    const empty = await this.isEmpty()
    if (!empty) return
    const legacy = await getLegacy()
    if (!legacy.version && !legacy.data) return
    await this.migrateFromStorage(legacy)
    await removeLegacy()
  }

  async load(): Promise<DummyState> {
    const row = (await this.#db.get(DUMMY_STORE, DUMMY_KEY)) as
      | (DummyState & { id: string })
      | undefined
    if (!row) return { ...DEFAULT_DUMMY_STATE }
    const { id: _id, ...state } = row
    return state
  }

  async save(state: DummyState): Promise<void> {
    await this.#db.put(DUMMY_STORE, { id: DUMMY_KEY, ...state })
  }
}

/** Key-value–backed backend — used on mobile (no IDB). */
class DummyKeyValueBackend implements IDummyBackend {
  #store: Record<string, any>

  constructor(store: Record<string, any>) {
    this.#store = store
  }

  // Data already lives in its final location, so nothing here migrates.
  async isEmpty(): Promise<boolean> {
    return false
  }

  async migrateFromStorage(_state: DummyState): Promise<void> {}

  async ensureMigrated(_getLegacy: () => Promise<DummyState>, _remove: () => Promise<void>) {}

  async load(): Promise<DummyState> {
    return { ...(this.#store['dummy'] ?? DEFAULT_DUMMY_STATE) }
  }

  async save(state: DummyState): Promise<void> {
    this.#store['dummy'] = state
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DummyController
//
// Template for any controller that follows the IDB backend pattern.
// Replace DummyState / IDummyBackend with the real types when wiring a new
// controller. The three steps in #load() must remain in this exact order.
// ─────────────────────────────────────────────────────────────────────────────

class DummyController {
  #backend: IDummyBackend
  state: DummyState = { ...DEFAULT_DUMMY_STATE }

  constructor(backend: IDummyBackend) {
    this.#backend = backend
  }

  /**
   * Mirrors a real controller's #load():
   *   step 1 — migrate legacy data before reading anything
   *   step 2 — load startup state from the backend
   */
  async load(
    getLegacy: () => Promise<DummyState>,
    removeLegacy: () => Promise<void>
  ): Promise<void> {
    await this.#backend.ensureMigrated(getLegacy, removeLegacy)
    this.state = await this.#backend.load()
  }

  async update(newState: DummyState): Promise<void> {
    this.state = newState
    await this.#backend.save(newState)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let db: AmbireIdbDatabase

// Opens an isolated test DB rather than going through openAmbireIdb(), so the
// DummyController scenarios stay independent of the production manifest and do not
// need updating every time a store or version is added to it.
async function openTestDb(): Promise<AmbireIdbDatabase> {
  return openDB('integration-test', 1, {
    upgrade(d) {
      d.createObjectStore('accountsOps', { keyPath: ['accountAddr', 'chainId', 'id'] })
      d.createObjectStore('phishing', { keyPath: 'id' })
    }
  })
}

beforeEach(async () => {
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
  ;(global as any).navigator = {}
  db = await openTestDb()
})

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic controller (IDB path)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dynamic controller — IDB path', () => {
  test('state reflects legacy storage after first init', async () => {
    const ctrl = new DummyController(new DummyIdbBackend(db))
    const legacy: DummyState = { version: 3, data: 'migrated-value' }

    await ctrl.load(
      async () => legacy,
      async () => {}
    )

    expect(ctrl.state.version).toBe(3)
    expect(ctrl.state.data).toBe('migrated-value')
  })

  test('migration runs before load — ordering guarantee', async () => {
    const backend = new DummyIdbBackend(db)
    const ctrl = new DummyController(backend)
    const legacy: DummyState = { version: 5, data: 'must-arrive-before-load' }

    // #load() awaits ensureMigrated, then reads — data must be present
    await ctrl.load(
      async () => legacy,
      async () => {}
    )

    expect(ctrl.state.data).toBe('must-arrive-before-load')
  })

  test('legacy storage key is removed after migration', async () => {
    const ctrl = new DummyController(new DummyIdbBackend(db))
    const removeSpy = jest.fn(async () => {})

    await ctrl.load(async () => ({ version: 1, data: 'x' }), removeSpy)

    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  test('second init (service worker restart) skips migration and reads IDB', async () => {
    const ctrl1 = new DummyController(new DummyIdbBackend(db))
    await ctrl1.load(
      async () => ({ version: 7, data: 'original' }),
      async () => {}
    )

    // Simulate restart: new controller instance, same db
    const getLegacySpy = jest.fn(async () => ({ version: 99, data: 'stale' }))
    const ctrl2 = new DummyController(new DummyIdbBackend(db))
    await ctrl2.load(getLegacySpy, async () => {})

    expect(getLegacySpy).not.toHaveBeenCalled()
    expect(ctrl2.state.version).toBe(7)
  })

  test('fresh install with no legacy data loads default state', async () => {
    const ctrl = new DummyController(new DummyIdbBackend(db))

    await ctrl.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    expect(ctrl.state).toEqual(DEFAULT_DUMMY_STATE)
  })

  test('update persists state so the next init reads the saved value', async () => {
    const ctrl = new DummyController(new DummyIdbBackend(db))
    await ctrl.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    await ctrl.update({ version: 2, data: 'saved' })

    const ctrl2 = new DummyController(new DummyIdbBackend(db))
    await ctrl2.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )
    expect(ctrl2.state.data).toBe('saved')
  })

  test('propagates error when getLegacy throws during migration', async () => {
    const ctrl = new DummyController(new DummyIdbBackend(db))
    const boom = new Error('storage read failed')

    await expect(
      ctrl.load(
        async () => {
          throw boom
        },
        async () => {}
      )
    ).rejects.toThrow('storage read failed')
  })

  test('IDB data is intact when removeLegacy throws after save — next load skips migration', async () => {
    const ctrl = new DummyController(new DummyIdbBackend(db))
    const legacy: DummyState = { version: 4, data: 'migrated' }

    // removeLegacy fails, but the save to IDB already completed
    await expect(
      ctrl.load(
        async () => legacy,
        async () => {
          throw new Error('cleanup failed')
        }
      )
    ).rejects.toThrow('cleanup failed')

    // IDB is now non-empty — the next load must find the data and skip migration
    const getLegacySpy = jest.fn(async (): Promise<DummyState> => ({ ...DEFAULT_DUMMY_STATE }))
    const ctrl2 = new DummyController(new DummyIdbBackend(db))
    await ctrl2.load(getLegacySpy, async () => {})

    expect(getLegacySpy).not.toHaveBeenCalled()
    expect(ctrl2.state.data).toBe('migrated')
  })

  test('skips migration when version is 0 and data is empty — guard treats both as falsy', async () => {
    const ctrl = new DummyController(new DummyIdbBackend(db))
    const removeSpy = jest.fn(async () => {})

    await ctrl.load(async () => ({ version: 0, data: '' }), removeSpy)

    expect(removeSpy).not.toHaveBeenCalled()
    expect(ctrl.state).toEqual(DEFAULT_DUMMY_STATE)
  })

  test('migrates when version is 0 but data is non-empty — only the falsy-both case is skipped', async () => {
    // The guard is `!version && !data` — non-empty data triggers migration even at version 0.
    const ctrl = new DummyController(new DummyIdbBackend(db))

    await ctrl.load(
      async () => ({ version: 0, data: 'payload-only' }),
      async () => {}
    )

    expect(ctrl.state.data).toBe('payload-only')
  })

  test('concurrent load() calls complete without data loss', async () => {
    const legacy: DummyState = { version: 1, data: 'concurrent' }
    const ctrl1 = new DummyController(new DummyIdbBackend(db))
    const ctrl2 = new DummyController(new DummyIdbBackend(db))

    // Both instances start before either has written — both will see isEmpty()=true
    // and run migration. The second put overwrites with identical data.
    await Promise.all([
      ctrl1.load(
        async () => legacy,
        async () => {}
      ),
      ctrl2.load(
        async () => legacy,
        async () => {}
      )
    ])

    expect(ctrl1.state.data).toBe('concurrent')
    expect(ctrl2.state.data).toBe('concurrent')

    // IDB holds exactly one record (the second put was idempotent)
    const backend = new DummyIdbBackend(db)
    expect(await backend.load()).toEqual(legacy)
  })

  test('three sequential update() calls — only the last value survives reload', async () => {
    const ctrl = new DummyController(new DummyIdbBackend(db))
    await ctrl.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    await ctrl.update({ version: 1, data: 'first' })
    await ctrl.update({ version: 2, data: 'second' })
    await ctrl.update({ version: 3, data: 'third' })

    const ctrl2 = new DummyController(new DummyIdbBackend(db))
    await ctrl2.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    expect(ctrl2.state.version).toBe(3)
    expect(ctrl2.state.data).toBe('third')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Static controller (key-value storage path)
// ─────────────────────────────────────────────────────────────────────────────

describe('Static controller — key-value storage path', () => {
  test('loads existing state from storage without migration', async () => {
    const store = { dummy: { version: 4, data: 'from-storage' } }
    const ctrl = new DummyController(new DummyKeyValueBackend(store))

    const getLegacySpy = jest.fn(async () => ({ ...DEFAULT_DUMMY_STATE }))
    const removeSpy = jest.fn(async () => {})
    await ctrl.load(getLegacySpy, removeSpy)

    expect(ctrl.state.version).toBe(4)
    expect(ctrl.state.data).toBe('from-storage')
    // ensureMigrated is a no-op — neither callback is touched
    expect(getLegacySpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })

  test('loads default state on a brand-new install', async () => {
    const store = {}
    const ctrl = new DummyController(new DummyKeyValueBackend(store))

    await ctrl.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    expect(ctrl.state).toEqual(DEFAULT_DUMMY_STATE)
  })

  test('update persists state to storage', async () => {
    const store: Record<string, any> = {}
    const ctrl = new DummyController(new DummyKeyValueBackend(store))
    await ctrl.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    await ctrl.update({ version: 1, data: 'written' })

    expect(store['dummy']).toEqual({ version: 1, data: 'written' })
  })

  test('three sequential update() calls — only the last value survives in storage', async () => {
    const store: Record<string, any> = {}
    const ctrl = new DummyController(new DummyKeyValueBackend(store))
    await ctrl.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    await ctrl.update({ version: 1, data: 'first' })
    await ctrl.update({ version: 2, data: 'second' })
    await ctrl.update({ version: 3, data: 'third' })

    expect(store['dummy']).toEqual({ version: 3, data: 'third' })
  })

  test('mutating the loaded state does not affect subsequent loads', async () => {
    const store = { dummy: { version: 1, data: 'original' } }
    const ctrl = new DummyController(new DummyKeyValueBackend(store))
    await ctrl.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    // Mutate the controller's in-memory state after load
    ctrl.state.data = 'mutated'

    // A new controller reading the same store must see the original value
    const ctrl2 = new DummyController(new DummyKeyValueBackend(store))
    await ctrl2.load(
      async () => ({ ...DEFAULT_DUMMY_STATE }),
      async () => {}
    )

    expect(ctrl2.state.data).toBe('original')
  })
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
        reconcileSchema(d, tx as AmbireIdbUpgradeTransaction)
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
        reconcileSchema(d, tx as AmbireIdbUpgradeTransaction, nextStores)
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
        reconcileSchema(d, tx as AmbireIdbUpgradeTransaction)
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
        reconcileSchema(d, tx as AmbireIdbUpgradeTransaction)
      }
    })
    const before = [...first.transaction('accountsOps').store.indexNames].sort()
    first.close()

    const second = await openDB('ambire-dummy-idempotent', 2, {
      upgrade(d, _o, _n, tx) {
        reconcileSchema(d, tx as AmbireIdbUpgradeTransaction)
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
        reconcileSchema(d, tx as AmbireIdbUpgradeTransaction)
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

    const nextStores = [...AMBIRE_IDB_SCHEMA.stores, { storeName: 'phishing', keyPath: 'id' }]
    const v2Db = await openDB('ambire-dummy-data-upgrade', 2, {
      upgrade(d, _o, _n, tx) {
        reconcileSchema(d, tx as AmbireIdbUpgradeTransaction, nextStores)
      }
    })

    // Existing v1 row must be intact
    const row = await v2Db.get('accountsOps', [ACCOUNT, '1', 'op-1'])
    expect(row).toBeDefined()
    expect((row as any).id).toBe('op-1')

    // New store must be empty but functional
    expect(await v2Db.count('phishing')).toBe(0)
    const ctrl = new DummyController(new DummyIdbBackend(v2Db))
    await ctrl.load(
      async () => ({ version: 1, data: 'post-upgrade' }),
      async () => {}
    )
    expect(ctrl.state.data).toBe('post-upgrade')

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
  ): Promise<{ db: AmbireIdbDatabase; applied: number[] }> {
    let applied: number[] = []
    const db = await openDB(dbName, version, {
      upgrade(d, oldVersion, newVersion, tx) {
        applied = applyMigrations(
          d,
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
          status: 'success',
          op: {}
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
      for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
        expect(retried.objectStoreNames.contains(storeDef.storeName)).toBe(true)
      }
      retried.close()
    } finally {
      resetAmbireIdbForTesting()
    }
  })
})
