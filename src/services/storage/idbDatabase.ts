/**
 * Global IDB initializer for the 'ambire' database.
 *
 * Call openAmbireIdb() once at background/app startup and AWAIT it before
 * constructing any controller. It opens a single IDBPDatabase connection,
 * reconciles structure against AMBIRE_IDB_SCHEMA, runs any pending data-migration
 * handlers, and caches the result — subsequent calls return the same promise.
 * Awaiting it up front is what guarantees every schema migration has completed
 * before a controller can read.
 *
 * Two distinct kinds of migration meet here, and they are easy to confuse:
 *   - SCHEMA migrations (this file): stores and indexes inside IDB, applied in
 *     onupgradeneeded. Structure comes from the manifest via reconcileSchema();
 *     migrationHandlers only transform existing rows.
 *   - DATA migrations: moving a controller's payload out of key-value storage
 *     into IDB, once, at controller load time. Implemented per-backend as
 *     ensureMigrated() — see ActivityIdbStorage in activityIdb.ts.
 *
 * On mobile, the caller does not invoke openAmbireIdb() — it passes undefined to
 * MainController instead, which propagates it to child controllers, and each falls
 * back to its key-value backend. No platform check is needed inside this module.
 */

import { IDBPDatabase, IDBPTransaction, openDB } from 'idb'

import { AMBIRE_IDB_SCHEMA, IdbStoreDef } from './idbSchema'

export type AmbireIdbDatabase = IDBPDatabase<any>

/** The versionchange transaction handed to migration handlers. */
export type AmbireIdbUpgradeTransaction = IDBPTransaction<any, string[], 'versionchange'>

// ─────────────────────────────────────────────────────────────────────────────
// Structural reconciliation
//
// AMBIRE_IDB_SCHEMA is the single source of truth for structure. reconcileSchema
// creates any store or index in the manifest that does not exist yet, so a
// purely additive schema change (new store, or new index on an existing store)
// needs nothing beyond adding it to the manifest and bumping dbVersion.
//
// This runs on every upgrade and is idempotent, which closes two gaps that a
// per-version create-store handler leaves open:
//   - A fresh install and an upgrading install end up on identical structure.
//   - An index added to an existing store reaches users who already have that
//     store, not just fresh installs.
//
// It only ever ADDS. Deleting a store or an index from the manifest does not
// remove it from databases that already have it — that needs an explicit
// deleteObjectStore/deleteIndex in the handler for the version that drops it.
// ─────────────────────────────────────────────────────────────────────────────

export function reconcileSchema(
  db: AmbireIdbDatabase,
  tx: AmbireIdbUpgradeTransaction,
  // Overridable only for tests, so a new store can be exercised without
  // mutating the production manifest.
  stores: IdbStoreDef[] = AMBIRE_IDB_SCHEMA.stores
): void {
  for (const storeDef of stores) {
    const store = db.objectStoreNames.contains(storeDef.storeName)
      ? tx.objectStore(storeDef.storeName)
      : db.createObjectStore(storeDef.storeName, { keyPath: storeDef.keyPath })

    for (const idx of storeDef.indexes ?? []) {
      if (store.indexNames.contains(idx.name)) continue

      store.createIndex(idx.name, idx.keyPath)
      console.log(`[AmbireIdb] created index "${idx.name}" on "${storeDef.storeName}"`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration handlers
//
// Each handler is keyed by the version it migrates TO. When a user upgrades
// from v(n) to v(m), every handler from n+1 to m runs in order inside the
// single onupgradeneeded transaction.
//
// Handlers exist for DATA transformations — rewriting or backfilling existing
// rows. Structure is handled declaratively by reconcileSchema(), which runs
// before any handler so a handler may read from and write to stores and indexes
// introduced by the same upgrade.
//
// Rules:
//   - Use `tx` for every read/write of existing rows. Do not open a new
//     transaction; only the versionchange transaction is valid here.
//   - Handlers are SYNCHRONOUS. To transform existing rows, chain off the read
//     rather than awaiting it — the versionchange transaction stays alive across
//     microtasks, so further requests issued from a .then() still land inside the
//     same upgrade. Awaiting anything non-IDB would let the transaction commit:
//         store.getAll().then((rows) => rows.forEach((r) => store.put(migrate(r))))
//     Proven by 'a handler can read and transform rows written by an earlier
//     version' in idbIntegration.test.ts.
//   - Never remove a handler — the chain must stay intact for users upgrading
//     from any prior version.
//   - Every version from 1..dbVersion must have an entry, even a no-op one, so
//     that a version bump is always a deliberate act. This is enforced by a
//     test in idbIntegration.test.ts.
//   - A key that has already been migrated out of key-value storage into IDB can
//     no longer be reached by a StorageController migration — transform it here.
// ─────────────────────────────────────────────────────────────────────────────

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

  openPromise = openDB(AMBIRE_IDB_SCHEMA.dbName, AMBIRE_IDB_SCHEMA.dbVersion, {
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
