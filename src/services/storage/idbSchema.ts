/**
 * Static IDB schema manifest — the single source of truth for the 'ambire' database.
 *
 * All stores, keyPaths, and indexes are declared here. The global IdbDatabase
 * initializer (step 2) reads this manifest to open the database, create stores,
 * and run versioned migrations in onupgradeneeded.
 *
 * Rules for making schema changes:
 *   1. Add or modify a store definition below.
 *   2. Bump DB_VERSION by 1.
 *   3. Add a migration entry to DB_MIGRATIONS describing what changed and how
 *      to transform existing rows (if any).
 *   Never remove a migration entry — the chain must stay intact so users
 *   upgrading from any prior version reach the current schema.
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
  // Migrations run sequentially in onupgradeneeded. Each entry describes what
  // changed between two versions. Add data-transformation logic in the global
  // IdbDatabase initializer (idbDatabase.ts) keyed by toVersion.
  migrations: [
    {
      fromVersion: 0,
      toVersion: 1,
      description: 'Initial schema: accountsOps store with timestamp and status indexes'
    }
  ]
}
