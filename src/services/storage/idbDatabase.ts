/**
 * Global IDB initializer for the 'ambire' database.
 *
 * Call openAmbireIdb() once at background/app startup. It opens a single
 * IDBPDatabase connection, runs all pending migrations via versioned handlers,
 * and caches the result. Subsequent calls return the same promise.
 *
 * On mobile, the caller does not invoke openAmbireIdb() — it passes
 * undefined to MainController instead, which propagates it to child
 * controllers. No platform check is needed inside this module.
 */

import { IDBPDatabase, openDB } from 'idb'

import { AMBIRE_IDB_SCHEMA } from './idbSchema'

export type AmbireIdbDatabase = IDBPDatabase<any>

// ─────────────────────────────────────────────────────────────────────────────
// Migration handlers
//
// Each handler is keyed by the version it migrates TO. When a user upgrades
// from v(n) to v(m), every handler from n+1 to m runs in order inside the
// single onupgradeneeded transaction.
//
// Rules:
//   - Store/index creation belongs in the handler matching the version that
//     introduced it (v1 for the initial schema, v2 for the next change, etc.)
//   - Data transformations use the versionchange `tx` for reads/writes.
//   - Never remove a handler — the chain must stay intact for users upgrading
//     from any prior version.
// ─────────────────────────────────────────────────────────────────────────────

type MigrationHandler = (db: AmbireIdbDatabase) => void

const migrationHandlers: Record<number, MigrationHandler> = {
  // v0 → v1: initial schema — create all stores defined in AMBIRE_IDB_SCHEMA.
  1: (db) => {
    for (const storeDef of AMBIRE_IDB_SCHEMA.stores) {
      if (db.objectStoreNames.contains(storeDef.storeName)) continue

      const store = db.createObjectStore(storeDef.storeName, {
        keyPath: storeDef.keyPath
      })
      for (const idx of storeDef.indexes ?? []) {
        store.createIndex(idx.name, idx.keyPath)
      }

      console.log(`[AmbireIdb] v1: created store "${storeDef.storeName}"`)
    }
  }
  // Add future migration handlers here, e.g.:
  // 2: (db) => { ... }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let openPromise: Promise<AmbireIdbDatabase> | null = null

export function openAmbireIdb(): Promise<AmbireIdbDatabase> {
  if (openPromise) return openPromise

  openPromise = openDB(AMBIRE_IDB_SCHEMA.dbName, AMBIRE_IDB_SCHEMA.dbVersion, {
    upgrade(db, oldVersion, newVersion) {
      const targetVersion = newVersion ?? AMBIRE_IDB_SCHEMA.dbVersion
      console.log(
        `[AmbireIdb] Upgrading "${AMBIRE_IDB_SCHEMA.dbName}" v${oldVersion} → v${targetVersion}`
      )

      for (let v = oldVersion + 1; v <= targetVersion; v++) {
        const handler = migrationHandlers[v]
        if (handler) {
          handler(db)
        } else {
          console.warn(
            `[AmbireIdb] No migration handler for version ${v} — schema may be incomplete`
          )
        }
      }
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
 * Reset the singleton — for use in tests only.
 * Call before replacing global.indexedDB with a fresh IDBFactory.
 */
export function resetAmbireIdbForTesting(): void {
  openPromise = null
}
