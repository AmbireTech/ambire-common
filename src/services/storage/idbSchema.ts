import { DBSchema } from 'idb'

import { SubmittedAccountOp, SubmittedAccountOpLike } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'

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

/**
 * Row stored in the 'accountsOps' store. accountAddr/chainId/id form the compound primary
 * key; timestamp and status are denormalized copies that the two indexes sort on.
 */
export interface IdbAccountOpRow {
  accountAddr: string
  // String copy of op.chainId — BigInt is not a valid IDB key type, so it cannot be used
  // directly in the compound keyPath or index keys.
  chainId: string
  id: string
  timestamp: number
  status: AccountOpStatus
  // Stored via the Structured Clone Algorithm, which preserves BigInt natively — no JSON
  // serialization needed.
  op: SubmittedAccountOp | SubmittedAccountOpLike
}

/**
 * Row stored in the 'phishing' store — a single document under the id 'snapshot'.
 * PhishingSnapshot is derived from this (Omit<…, 'id'>), so the fields live in one place.
 */
export interface IdbPhishingRow {
  id: string
  version: number
  updatedAt: number
  domains: string[]
  addresses: string[]
}

/**
 * Typed view of the database, so store names, key shapes, row shapes and index key types are
 * all checked at the call site instead of being `any`.
 *
 * Must be kept in step with AMBIRE_IDB_SCHEMA below by hand — TypeScript cannot derive one
 * from the other, because the manifest is a runtime value read by reconcileSchema().
 *
 * A store declared here but absent from the manifest is never created — the type describes
 * the intended shape, the manifest controls what exists. Both stores below are in the
 * manifest today.
 */
export interface AmbireIdbSchema extends DBSchema {
  accountsOps: {
    key: [string, string, string]
    value: IdbAccountOpRow
    indexes: {
      'by-account-chain-timestamp': [string, string, number]
      'by-account-chain-status': [string, string, AccountOpStatus]
    }
  }
  phishing: {
    key: string
    value: IdbPhishingRow
  }
}

interface IdbIndexDef {
  name: string
  keyPath: string | string[]
}

export interface IdbStoreDef {
  storeName: string
  keyPath: string | string[]
  indexes?: IdbIndexDef[]
}

interface IdbMigration {
  fromVersion: number
  toVersion: number
  description: string
}

interface IdbSchema {
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
    },
    {
      // Single document under the id 'snapshot' — no indexes, it is always read whole.
      storeName: 'phishing',
      keyPath: 'id'
    }
  ],
  // Human-readable changelog of the schema. Not read at runtime — the executable
  // counterparts are `stores` above (structure) and `migrationHandlers` in
  // idbDatabase.ts keyed by toVersion (row transformations).
  migrations: [
    {
      fromVersion: 0,
      toVersion: 1,
      description:
        'Initial schema: accountsOps store with timestamp and status indexes, phishing snapshot store'
    }
  ]
}
