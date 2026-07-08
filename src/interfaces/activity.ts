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
 * Interface for IndexedDB-backed storage of account operations.
 * Provides minimal, targeted reads/writes compared to full blob serialization.
 */
export interface IActivityIdbStorage {
  /**
   * Load minimal startup dataset: all pending ops + 20 most recent per (account, chainId)
   * Used during ActivityController initialization.
   */
  loadStartupOps(): Promise<InternalAccountsOps>

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
   * Accepts both internal and external account ops.
   */
  putOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string,
    ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
  ): Promise<void>

  /**
   * Batch write multiple (account, chainId) records in a single transaction.
   * More efficient than multiple individual puts.
   * Accepts both internal and external account ops.
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
   * One-time migration: import all ops from chrome.storage.local into IDB.
   * After successful import, the caller should remove the key from chrome.storage.local.
   */
  migrateFromStorage(data: InternalAccountsOps): Promise<void>

  /**
   * Check if IDB has any data (used to detect if migration is needed).
   */
  isEmpty(): Promise<boolean>

  /**
   * Write a single new op and optionally delete the op evicted by the in-memory trim.
   * Use instead of putOpsForAccountAndChain when adding one op at a time.
   */
  putSingleOp(
    accountAddr: string,
    chainId: bigint | string,
    op: SubmittedAccountOp,
    trimmedId?: string
  ): Promise<void>

  /**
   * Update existing rows in place (e.g. status or balance-change updates).
   * Only the provided ops are written — no range-delete.
   */
  updateOps(ops: SubmittedAccountOp[]): Promise<void>
}
