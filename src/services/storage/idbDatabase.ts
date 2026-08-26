/**
 * Global IDB initializer for the 'ambire' database.
 *
 * Call openAmbireIdb() once at startup and AWAIT it before constructing any controller —
 * that await is what guarantees every schema migration finished before a controller reads.
 * Mobile never calls it and passes undefined instead, so no platform check belongs here.
 *
 * Startup order, the schema/data migration distinction, and the rules for writing a
 * migration handler are documented in ./README.md. Read it before changing this file.
 */

import { IDBPDatabase, IDBPTransaction, openDB, StoreNames } from 'idb'

import { AmbireIdbSchema, AMBIRE_IDB_SCHEMA, IdbStoreDef } from './idbSchema'

export type AmbireIdbDatabase = IDBPDatabase<AmbireIdbSchema>

/** The versionchange transaction handed to migration handlers. */
export type AmbireIdbUpgradeTransaction = IDBPTransaction<
  AmbireIdbSchema,
  ArrayLike<StoreNames<AmbireIdbSchema>>,
  'versionchange'
>

/**
 * Create every store and index in the manifest that does not exist yet. Idempotent, runs on
 * every upgrade, and only ever ADDS — see "Structure is declarative" in ./README.md.
 */
export function reconcileSchema(
  db: AmbireIdbDatabase,
  tx: AmbireIdbUpgradeTransaction,
  // Overridable only for tests, so a new store can be exercised without
  // mutating the production manifest.
  stores: IdbStoreDef[] = AMBIRE_IDB_SCHEMA.stores
): void {
  // Store and index names are runtime values here, so nothing can be checked against
  // AmbireIdbSchema. Cast once, narrowly, rather than weakening the type every consumer sees.
  const untypedDb = db as unknown as IDBPDatabase
  const untypedTx = tx as unknown as IDBPTransaction<unknown, string[], 'versionchange'>

  for (const storeDef of stores) {
    const store = untypedDb.objectStoreNames.contains(storeDef.storeName)
      ? untypedTx.objectStore(storeDef.storeName)
      : untypedDb.createObjectStore(storeDef.storeName, { keyPath: storeDef.keyPath })

    for (const idx of storeDef.indexes ?? []) {
      if (store.indexNames.contains(idx.name)) continue

      store.createIndex(idx.name, idx.keyPath)
      console.log(`[AmbireIdb] created index "${idx.name}" on "${storeDef.storeName}"`)
    }
  }
}

/**
 * Data-migration handlers, keyed by the version they migrate TO. Upgrading v(n) → v(m) runs
 * n+1..m in order inside the single onupgradeneeded transaction. Structure is NOT created
 * here — reconcileSchema() runs first.
 *
 * ⚠️ Handlers are SYNCHRONOUS. Chain off the read, never await it:
 *       store.getAll().then((rows) => rows.forEach((r) => store.put(migrate(r))))
 * Awaiting a non-IDB promise lets the versionchange transaction commit and the writes vanish
 * with no error — no unit test catches it, so do not tidy this into an `await`.
 *
 * The full rules for adding one are in ./README.md under "Writing a migration handler".
 */
export type MigrationHandler = (db: AmbireIdbDatabase, tx: AmbireIdbUpgradeTransaction) => void

export const migrationHandlers: Record<number, MigrationHandler> = {
  // v0 → v1: initial schema. reconcileSchema() creates accountsOps and its
  // indexes; there is no pre-existing data to transform.
  1: () => {
    console.log('[AmbireIdb] v1: initial schema applied')
  }
}

/**
 * Reconcile structure, then run every data-migration handler in (oldVersion,
 * targetVersion] in ascending order. Returns the versions whose handlers ran,
 * which lets tests assert the sequence without duplicating the loop.
 *
 * Exported so that openAmbireIdb() and the tests exercise the same code path.
 *
 * @param handlers - Overridable only for tests; production always uses the
 *        module-level registry.
 */
export function applyMigrations(
  db: AmbireIdbDatabase,
  tx: AmbireIdbUpgradeTransaction,
  oldVersion: number,
  targetVersion: number,
  handlers: Record<number, MigrationHandler> = migrationHandlers
): number[] {
  reconcileSchema(db, tx)

  const applied: number[] = []
  for (let v = oldVersion + 1; v <= targetVersion; v++) {
    const handler = handlers[v]
    if (!handler) continue

    handler(db, tx)
    applied.push(v)
  }

  return applied
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let openPromise: Promise<AmbireIdbDatabase> | null = null

export function openAmbireIdb(): Promise<AmbireIdbDatabase> {
  if (openPromise) return openPromise

  openPromise = openDB<AmbireIdbSchema>(AMBIRE_IDB_SCHEMA.dbName, AMBIRE_IDB_SCHEMA.dbVersion, {
    upgrade(db, oldVersion, newVersion, tx) {
      const targetVersion = newVersion ?? AMBIRE_IDB_SCHEMA.dbVersion
      console.log(
        `[AmbireIdb] Upgrading "${AMBIRE_IDB_SCHEMA.dbName}" v${oldVersion} → v${targetVersion}`
      )

      applyMigrations(db, tx, oldVersion, targetVersion)
    },

    blocked(currentVersion, blockedVersion) {
      console.warn(
        `[AmbireIdb] Upgrade to v${blockedVersion} is blocked by an open connection at v${currentVersion} (another tab)`
      )
    },

    blocking(currentVersion, blockedVersion) {
      // A newer version of the app is trying to open the DB. Close this
      // connection so the upgrade can proceed without the user having to
      // reload manually.
      console.warn(
        `[AmbireIdb] This v${currentVersion} connection is blocking an upgrade to v${blockedVersion} — closing`
      )
      const prevPromise = openPromise
      openPromise = null
      prevPromise?.then((db) => db.close()).catch(() => {})
    },

    terminated() {
      // The browser closed the connection on us — storage pressure, the user
      // clearing site data, and so on. Nothing above this layer gets told, so
      // without dropping the cached promise every later call would keep handing
      // out the same dead connection until the whole context restarts.
      console.warn('[AmbireIdb] Connection was terminated by the browser — dropping the cache')
      openPromise = null
    }
  }).catch((error) => {
    // Allow a subsequent openAmbireIdb() call to retry after a transient failure.
    openPromise = null
    throw error
  })

  return openPromise
}

/**
 * True when the error means our connection handle is dead while the database
 * itself is fine — the connection was closed by blocking(), terminated by the
 * browser, or otherwise went away underneath us.
 *
 * IndexedDB throws InvalidStateError from transaction() as soon as a connection
 * has its close-pending flag set, so this is the signal that a caller should
 * reopen and retry rather than give up.
 */
export function isClosedConnectionError(error: unknown): boolean {
  // Matched by name rather than by instanceof: this arrives as a DOMException in
  // browsers and as a library-defined error class under fake-indexeddb, and
  // neither is reliably an instance of Error.
  if (typeof error !== 'object' || error === null) return false

  return (error as { name?: unknown }).name === 'InvalidStateError'
}

/**
 * Drop the cached connection so the next openAmbireIdb() opens a fresh one.
 *
 * blocking() and terminated() already do this when they fire, but a connection can
 * also die without either event. In that case the cache still resolves to the dead
 * handle, so a caller recovering from isClosedConnectionError must invalidate first
 * — otherwise it reconnects to the same dead connection and fails again.
 */
export function invalidateAmbireIdbConnection(): void {
  openPromise = null
}

/**
 * Reset the singleton — for use in tests only.
 * Call before replacing global.indexedDB with a fresh IDBFactory.
 */
export function resetAmbireIdbForTesting(): void {
  openPromise = null
}
