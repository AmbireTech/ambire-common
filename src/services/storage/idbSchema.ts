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
  // Every txnId the op carries — its own plus one per call (the MultipleTxns shape). Absent
  // when it has none, which keeps such rows out of by-txn-id entirely.
  txnIds?: string[]
  // Stored via the Structured Clone Algorithm, which preserves BigInt natively — no JSON
  // serialization needed.
  op: SubmittedAccountOp | SubmittedAccountOpLike
}

/**
 * One blocklisted domain per row. The domain IS the key, so a lookup is a primary-key point
 * read and an update touches only the rows the server's delta named.
 */
export interface IdbPhishingDomainRow {
  domain: string
}

/** One blocklisted address per row, lowercased on write so lookups need no normalization. */
export interface IdbPhishingAddressRow {
  address: string
}

/**
 * Single document under the id 'meta'. Holds only the checkpoint the update protocol needs,
 * so it stays small enough to read on every service-worker wake-up.
 */
export interface IdbPhishingMetaRow {
  id: string
  version: number
  updatedAt: number
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
      'by-txn-id': string
    }
  }
  phishingDomains: {
    key: string
    value: IdbPhishingDomainRow
  }
  phishingAddresses: {
    key: string
    value: IdbPhishingAddressRow
  }
  phishingMeta: {
    key: string
    value: IdbPhishingMetaRow
  }
}

interface IdbIndexDef {
  name: string
  keyPath: string | string[]
  /** Indexes each element of an array-valued keyPath separately. Cannot be compound. */
  multiEntry?: boolean
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
        },
        {
          // Turns the duplicate check into a point lookup instead of a walk of the whole
          // group. multiEntry cannot be compound, so it is keyed on txnId alone — the
          // account is read back from the primary key, which already contains it.
          name: 'by-txn-id',
          keyPath: 'txnIds',
          multiEntry: true
        }
      ]
    },
    {
      // Row per domain rather than one blob: the server sends add/remove deltas, so an update
      // writes only what changed, and a lookup is a primary-key point read.
      storeName: 'phishingDomains',
      keyPath: 'domain'
    },
    {
      storeName: 'phishingAddresses',
      keyPath: 'address'
    },
    {
      // Version checkpoint only. Written in the same transaction as the rows it describes, so
      // a crash cannot leave rows applied under a stale version and replay or skip a delta.
      storeName: 'phishingMeta',
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
        'Initial schema: accountsOps with timestamp, status and txnId indexes; phishing domain, address and meta stores'
    }
  ]
}
