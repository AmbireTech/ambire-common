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
 * Persistence backend for account ops: ActivityIdbStorage (IndexedDB) or
 * ActivityKeyValueStorage (chrome.storage.local). ActivityController always holds one, so
 * it never branches on IDB availability.
 */
export interface IActivityOpsBackend {
  /**
   * Whether loadStartupOps() returns only a window rather than the whole history.
   *
   * The capability that drives every behavioural difference between adapters — expansion
   * markers, cache merging and the total-op count all exist only when this is true. Callers
   * branch on this, never on the concrete class.
   */
  readonly loadsPartially: boolean

  /**
   * One-time migration of the legacy blob into IDB. No-op on the key-value backend.
   * Takes callbacks to stay decoupled from IStorageController.
   *
   * isEmpty()/migrateFromStorage() stay off this interface — nobody calls them
   * polymorphically, and declaring them would force dead stubs onto the key-value class.
   */
  ensureMigrated(
    getStoredOps: () => Promise<InternalAccountsOps>,
    removeStoredOps: () => Promise<void>
  ): Promise<void>

  /** IDB: pending ops + up to 20 finalized per (account, chainId). Key-value: everything. */
  loadStartupOps(): Promise<InternalAccountsOps>

  /** Write one new op, and delete the op the in-memory trim evicted (if any). */
  putSingleOp(
    accountAddr: string,
    chainId: bigint | string,
    op: SubmittedAccountOp,
    trimmedId?: string
  ): Promise<void>

  /** Update existing rows in place (status, balance changes). */
  updateOps(ops: SubmittedAccountOp[]): Promise<void>

  /** Full history for one (account, chainId) — the lazy-load behind pagination. */
  getOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string
  ): Promise<SubmittedAccountOp[] | undefined>

  /** Write ops for one (account, chainId) pair. */
  putOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string,
    ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
  ): Promise<void>

  /** Batch write across multiple (account, chainId) records. */
  putMultiple(
    records: Array<{
      accountAddr: string
      chainId: bigint | string
      ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
    }>
  ): Promise<void>

  /** Delete every op for an account, across all chains. */
  deleteAccount(accountAddr: string): Promise<void>

  /**
   * Total persisted ops for an account. Needed because the IDB startup read is a bounded
   * window, so in-memory lengths are not a total.
   */
  countOpsForAccount(accountAddr: string): Promise<number>
}

/** @deprecated Use IActivityOpsBackend */
export type IActivityIdbStorage = IActivityOpsBackend
