import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { ControllerInterface } from './controller'

export type IActivityController = ControllerInterface<
  InstanceType<typeof import('../controllers/activity/activity').ActivityController>
>

export interface InternalAccountsOps {
  // account => network => SubmittedAccountOp[]
  [key: string]: { [key: string]: SubmittedAccountOp[] }
}

/** One per storage service. ActivityController always holds one, whichever is available. */
export interface IActivityOpsBackend {
  /**
   * Whether loadStartupOps() returns a window rather than everything. Callers branch on this,
   * never on the concrete class.
   */
  readonly loadsPartially: boolean

  /**
   * One-time migration of the legacy blob into IDB. No-op on the key-value backend.
   *
   * isEmpty()/migrateFromStorage() stay off this interface — declaring them would force dead
   * stubs onto the key-value class.
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

  updateOps(ops: SubmittedAccountOp[]): Promise<void>

  /** Full history for one (account, chainId) — the lazy-load behind pagination. */
  getOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string
  ): Promise<SubmittedAccountOp[] | undefined>

  /** For the one-time sentToHistory backfill only — never call this on a user-facing path. */
  getAllOps(): Promise<InternalAccountsOps>

  deleteAccount(accountAddr: string): Promise<void>

  /** Needed because the IDB startup read is a window, so in-memory lengths are not a total. */
  countOpsForAccount(accountAddr: string): Promise<number>
}
