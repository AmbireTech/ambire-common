import { SubmittedAccountOp, SubmittedAccountOpLike } from '../libs/accountOp/submittedAccountOp'
import { ControllerInterface } from './controller'

export type IActivityController = ControllerInterface<
  InstanceType<typeof import('../controllers/activity/activity').ActivityController>
>

export interface InternalAccountsOps {
  // account => network => SubmittedAccountOp[]
  [key: string]: { [key: string]: SubmittedAccountOp[] }
}

/**
 * Persistence backend for account operations.
 * Implementations: ActivityIdbStorage (IndexedDB) and ActivityKeyValueStorage (chrome.storage.local).
 * ActivityController always holds one of these — there are no conditional IDB checks in the controller.
 */
export interface IActivityOpsBackend {
  /**
   * One-time migration from legacy chrome.storage.local to IDB.
   * Called with callbacks so the interface stays decoupled from IStorageController.
   * IDB backend: migrates if empty; storage backend: no-op.
   *
   * isEmpty() and migrateFromStorage() are NOT part of this interface — they are
   * implementation details of how ActivityIdbStorage decides whether to migrate,
   * not something callers need polymorphically. Adding them here would force
   * ActivityKeyValueStorage to carry dead stub methods it never uses.
   */
  ensureMigrated(
    getStoredOps: () => Promise<InternalAccountsOps>,
    removeStoredOps: () => Promise<void>
  ): Promise<void>

  /**
   * Load the startup dataset.
   * IDB: returns pending ops + up to 20 finalized per (account, chainId).
   * Storage: returns the full ops blob.
   */
  loadStartupOps(): Promise<InternalAccountsOps>

  /**
   * Write a single new op and optionally delete the op evicted by the in-memory trim.
   */
  putSingleOp(
    accountAddr: string,
    chainId: bigint | string,
    op: SubmittedAccountOp,
    trimmedId?: string
  ): Promise<void>

  /**
   * Update existing rows in place (e.g. status or balance-change updates).
   */
  updateOps(ops: SubmittedAccountOp[]): Promise<void>

  /**
   * Fetch full history for a specific (account, chainId) pair.
   * Used for lazy-loading older history during pagination.
   */
  getOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string
  ): Promise<SubmittedAccountOp[] | undefined>

  /**
   * Write ops for a single (account, chainId) pair.
   */
  putOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string,
    ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
  ): Promise<void>

  /**
   * Batch write multiple (account, chainId) records.
   */
  putMultiple(
    records: Array<{
      accountAddr: string
      chainId: bigint | string
      ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
    }>
  ): Promise<void>

  /**
   * Delete all ops for an account across all chains.
   */
  deleteAccount(accountAddr: string): Promise<void>

  /**
   * Total number of persisted ops for an account, across every chain.
   *
   * Needed because the IDB startup read is a bounded window, so the in-memory group
   * lengths are NOT a transaction total. Counting in the backend keeps it cheap — IDB
   * counts a key range without deserializing rows.
   */
  countOpsForAccount(accountAddr: string): Promise<number>
}

/** @deprecated Use IActivityOpsBackend */
export type IActivityIdbStorage = IActivityOpsBackend
