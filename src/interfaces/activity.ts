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

  /**
   * Pending ops for every account, plus the finalized window for `finalizedFor` only —
   * finalized ops are only rendered for the account being viewed. Key-value reads everything.
   */
  loadStartupOps(finalizedFor?: string): Promise<InternalAccountsOps>

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

  deleteAccount(accountAddr: string): Promise<void>

  /**
   * Exact stored count, for the whole account or one of its chains. Needed because the IDB
   * startup read is a window, so in-memory lengths are not a total.
   */
  countOpsForAccount(accountAddr: string, chainId?: bigint | string): Promise<number>

  /**
   * The newest `limit` ops of one of an account's chains, newest first. Lets a caller serve
   * one page without reading the whole history.
   *
   * Per chain and not account-wide because callers render a chain subset: an account-wide
   * read would spend part of `limit` on chains the caller drops, leaving a short page.
   */
  getRecentOps(
    accountAddr: string,
    limit: number,
    chainId: bigint | string
  ): Promise<SubmittedAccountOp[]>
}
