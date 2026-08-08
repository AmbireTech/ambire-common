/**
 * Static IDB schema manifest — the single source of truth for the STRUCTURE of the
 * 'ambire' database.
 *
 * All stores, keyPaths, and indexes are declared here. reconcileSchema() in
 * idbDatabase.ts creates anything in this manifest that does not exist yet, on
 * every upgrade and idempotently. Structure is therefore declarative: a purely
 * additive change needs no hand-written migration code.
 *
 * Rules for making schema changes:
 *   1. Add or modify a store definition below.
 *   2. Bump dbVersion by 1 — reconcileSchema only runs during an upgrade, so
 *      without a version bump existing installs never pick the change up.
 *   3. Add an entry to `migrations` below describing what changed.
 *   4. Add a handler to `migrationHandlers` in idbDatabase.ts keyed by the new
 *      version. It may be a no-op: handlers exist for transforming EXISTING ROWS,
 *      not for creating stores or indexes. An entry is still required so that a
 *      version bump is always deliberate — a test enforces this.
 *
 * Never remove a migration entry or handler — the chain must stay intact so users
 * upgrading from any prior version reach the current schema.
 *
 * Note: `migrations` is documentation only. Nothing reads it at runtime; a test
 * checks that it forms a contiguous 0 → dbVersion chain so it cannot silently
 * drift out of step with the real version.
 */

export interface IdbIndexDef {
  name: string
  keyPath: string | string[]
}

export interface IdbStoreDef {
  storeName: string
  keyPath: string | string[]
  indexes?: IdbIndexDef[]
}

export interface IdbMigration {
  fromVersion: number
  toVersion: number
  description: string
}

export interface IdbSchema {
  dbName: string
  dbVersion: number
  stores: IdbStoreDef[]
  migrations: IdbMigration[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

export const AMBIRE_IDB_SCHEMA: IdbSchema = {
  dbName: 'ambire',
  dbVersion: 1,
  stores: [
    {
      storeName: 'accountsOps',
      keyPath: ['accountAddr', 'chainId', 'id'],
      indexes: [
        {
          name: 'by-account-chain-timestamp',
          keyPath: ['accountAddr', 'chainId', 'timestamp']
        },
        {
          name: 'by-account-chain-status',
          keyPath: ['accountAddr', 'chainId', 'status']
        }
      ]
    }
  ],
  // Human-readable changelog of the schema. Not read at runtime — the executable
  // counterparts are `stores` above (structure) and `migrationHandlers` in
  // idbDatabase.ts keyed by toVersion (row transformations).
  migrations: [
    {
      fromVersion: 0,
      toVersion: 1,
      description: 'Initial schema: accountsOps store with timestamp and status indexes'
    }
  ]
}
