import { IActivityOpsBackend, InternalAccountsOps } from '../../interfaces/activity';
import { IStorageController as IStorageControllerType } from '../../interfaces/storage';
import { SubmittedAccountOp, SubmittedAccountOpLike } from '../../libs/accountOp/submittedAccountOp';
import { AmbireIdbDatabase } from './idbDatabase';
export declare const STARTUP_RECENT_OPS_LIMIT = 20;
/**
 * Hard cap on ops per (account, chainId) group. Enforced twice and the two MUST agree — the
 * controller trims memory, putSingleOp guards the rows — or memory drops ops that storage
 * keeps and every page load re-adds them.
 */
export declare const MAX_OPS_PER_GROUP = 1000;
export declare class ActivityIdbStorage implements IActivityOpsBackend {
    #private;
    readonly loadsPartially = true;
    /**
     * @param db        - The connection opened at startup.
     * @param reconnect - Obtains a fresh connection when the current one dies. The
     *                    default is the openAmbireIdb() singleton, which returns the
     *                    cached connection normally and reopens once blocking() or
     *                    terminated() has dropped it. Overridable for tests.
     */
    constructor(db: AmbireIdbDatabase, reconnect?: () => Promise<AmbireIdbDatabase>);
    /**
     * Migrate the legacy blob into IDB, once.
     *
     * Emptiness is checked against IDB, not the legacy key, so a completed migration is cheap
     * to skip and a wiped store recovers from the retained copy on the next restart.
     *
     * KNOWN LIMITATION: cannot tell "never migrated" from "wiped, then partially
     * repopulated" — one row written after a wipe looks migrated. Accepted deliberately; see
     * the IndexedDB section in src/controllers/AGENTS.md.
     */
    /**
     * Fold a legacy payload back in WITHOUT overwriting what IDB already holds.
     *
     * Deliberately not putMultiple(): that clears each (account, chain) range before inserting,
     * so a stale legacy copy — frozen at migration time — would wipe every row written to IDB
     * since, taking confirmed ops back to pending. A plain upsert is no better, because the
     * stale copy would still overwrite newer rows.
     *
     * So only ops IDB does not have are inserted. An op both sides hold is left alone, unless
     * IDB has it pending and the payload has it finalized — the fallback session may have been
     * the one that saw it confirm. MAX_OPS_PER_GROUP is enforced on the merged result, oldest
     * first, so recovery cannot grow a group past the cap.
     */
    mergeGroups(ops: InternalAccountsOps): Promise<void>;
    ensureMigrated(getStoredOps: () => Promise<InternalAccountsOps>, removeStoredOps: () => Promise<void>): Promise<void>;
    /**
     * Load minimal startup dataset: all pending ops for every account, plus a finalized window
     * per chain — STARTUP_RECENT_OPS_LIMIT for `fullWindowFor`, STARTUP_RECENT_OPS_LIMIT_OTHER
     * for everyone else. Omit `fullWindowFor` to give every account the full window.
     *
     * Pending ops are needed wallet-wide — broadcastedButNotConfirmed drives which accounts get
     * status polling, and the pending/failed banners are built per account. Finalized ops are
     * mostly rendered for the account being viewed, so the full window for every account costs
     * (accounts x chains x 20) deserialized rows that nothing reads — but the shorter window
     * cannot be zero, because the readers listed on STARTUP_RECENT_OPS_LIMIT_OTHER ask about
     * accounts that are not selected and are all synchronous.
     *
     * Two transactions: a key-only cursor enumerates the (account, chainId) groups, then all
     * per-group queries run in parallel inside one transaction. Every per-group request is fired
     * before any await resolves, keeping the tx open.
     */
    loadStartupOps(fullWindowFor?: string): Promise<InternalAccountsOps>;
    /**
     * Write a single new op and optionally delete the op evicted by the in-memory trim.
     * O(1) IDB operations vs. the full-group rewrite of putMultiple.
     */
    putSingleOp(accountAddr: string, chainId: bigint | string, op: SubmittedAccountOp, trimmedId?: string): Promise<number>;
    /**
     * Update existing rows in place (status or balance-change updates).
     * Uses store.put() per op — no range-delete, only touched rows are written.
     */
    updateOps(ops: SubmittedAccountOp[]): Promise<void>;
    /**
     * Batch write multiple (account, chainId) pairs in a single transaction.
     * Existing rows for each pair are deleted first, then the new ops inserted.
     */
    putMultiple(records: Array<{
        accountAddr: string;
        chainId: bigint | string;
        ops: (SubmittedAccountOp | SubmittedAccountOpLike)[];
    }>): Promise<void>;
    /**
     * Delete all ops for an account across all chains.
     */
    deleteAccount(accountAddr: string): Promise<void>;
    /**
     * The newest `limit` ops for an account, newest first — across all chains, or one chain.
     *
     * This is what lets a caller serve a page without reading the whole history. The
     * cross-chain case needs by-account-timestamp; by-account-chain-timestamp cannot answer it.
     */
    getRecentOps(accountAddr: string, limit: number, chainId: bigint | string): Promise<SubmittedAccountOp[]>;
    /**
     * Whether the account already stores an op carrying this txnId.
     *
     * A point lookup on by-txn-id, reading KEYS only: the primary key is
     * [accountAddr, chainId, id], so the account is checked without deserializing any record.
     * Compared case-insensitively, because IDB keys are exact but addresses are not canonical.
     */
    hasOpWithTxnId(accountAddr: string, txnId: string): Promise<boolean>;
    /**
     * Every row for an account — count() is served from the index without deserializing rows.
     */
    countOpsForAccount(accountAddr: string, chainId?: bigint | string): Promise<number>;
    /**
     * One-time migration: import all ops from legacy blob storage into IDB.
     * After successful import, the caller should remove the key from legacy storage.
     */
    migrateFromStorage(data: InternalAccountsOps): Promise<void>;
    /**
     * Check if IDB has any data (used to detect if migration is needed).
     */
    isEmpty(): Promise<boolean>;
}
/**
 * chrome.storage.local–backed persistence for AccountsOps.
 * Used in environments without IndexedDB support (mobile).
 * Writes the full in-memory ops blob on every mutation — no row-level granularity.
 */
export declare class ActivityKeyValueStorage implements IActivityOpsBackend {
    #private;
    readonly loadsPartially = false;
    /**
     * @param storage - The storage controller to read/write from.
     * @param getOps  - Returns the controller's current in-memory AccountsOps so
     *                  write methods can persist the full up-to-date blob.
     */
    constructor(storage: IStorageControllerType, getOps: () => InternalAccountsOps);
    mergeGroups(_ops: InternalAccountsOps): Promise<void>;
    ensureMigrated(_g: () => Promise<InternalAccountsOps>, _r: () => Promise<void>): Promise<void>;
    loadStartupOps(_fullWindowFor?: string): Promise<InternalAccountsOps>;
    putSingleOp(_accountAddr: string, _chainId: bigint | string, _op: SubmittedAccountOp, _trimmedId?: string): Promise<number>;
    updateOps(_ops: SubmittedAccountOp[]): Promise<void>;
    deleteAccount(_accountAddr: string): Promise<void>;
    getRecentOps(accountAddr: string, limit: number, chainId: bigint | string): Promise<SubmittedAccountOp[]>;
    /**
     * On this backend the in-memory blob IS the complete history, so summing the group
     * lengths is already the true total.
     */
    hasOpWithTxnId(accountAddr: string, txnId: string): Promise<boolean>;
    countOpsForAccount(accountAddr: string, chainId?: bigint | string): Promise<number>;
}
//# sourceMappingURL=activityIdb.d.ts.map