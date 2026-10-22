import { InternalAccountsOps } from '../../interfaces/activity';
import { IStorageController } from '../../interfaces/storage';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { AmbireIdbDatabase } from './idbDatabase';
import { ReportPersistenceError } from './persistenceError';
interface AccountOpsPersistenceParams {
    storage: IStorageController;
    /** The connection opened at startup, or undefined where IDB does not exist (mobile). */
    idb?: AmbireIdbDatabase;
    /**
     * The controller's live in-memory ops. Expansion writes merged groups back into it, and
     * the key-value adapter serializes it on every write.
     */
    getCache: () => InternalAccountsOps;
    /** Reported instead of thrown — every method here degrades rather than failing a caller. */
    onError: ReportPersistenceError;
}
/**
 * Owns everything about *where* account ops live, so ActivityController does not have to.
 *
 * Picks a storage adapter from what it is given, runs the one-time data migration, falls
 * back when that fails, and keeps the in-memory cache coherent with a partially-loaded
 * backend. The controller calls plain methods and never branches on the backend.
 *
 * Adding a service (e.g. expo-sqlite on mobile) means writing an IActivityOpsBackend
 * adapter and selecting it in #pickAdapter — nothing else here or in the controller changes.
 *
 * No method rejects. This runs behind ActivityController's #initialLoadPromise, which every
 * public method awaits, so a single failure escaping here would break the controller for the
 * whole session.
 */
export declare class AccountOpsPersistence {
    #private;
    constructor({ storage, idb, getCache, onError }: AccountOpsPersistenceParams);
    /** Migrate if needed, then return the startup dataset. Bookkeeping is in finalizeInit(). */
    init(fullWindowFor?: string): Promise<InternalAccountsOps>;
    /** Bookkeeping nothing renders, so the caller can paint before paying for it. */
    finalizeInit(ops: InternalAccountsOps): Promise<void>;
    /**
     * Merge each chain's newest `limit` ops into the cache, so one page costs one read per chain.
     */
    ensureRecentLoaded(accountAddr: string, limit: number, chainIds: (bigint | string)[]): Promise<void>;
    /**
     * Whether the account already stores an op carrying this txnId.
     *
     * @returns true when the lookup fails, so a caller guarding against duplicates treats
     *          "unknown" as "present" — a stored duplicate is permanent, a skipped op is not.
     */
    hasOpWithTxnId(accountAddr: string, txnId: string): Promise<boolean>;
    /** Persist one new op, and delete the op the caller's in-memory trim evicted. */
    addOp(accountAddr: string, chainId: bigint | string, op: SubmittedAccountOp, trimmedId?: string): Promise<void>;
    updateOps(ops: SubmittedAccountOp[]): Promise<void>;
    /** Drop an account's rows and every marker keyed to it. */
    removeAccount(accountAddr: string): Promise<void>;
    /** Total ops ever. Synchronous because BannerController evaluates inside a sync callback. */
    getTotalOpsCount(accountAddr: string): number;
    /**
     * Exact stored count, scoped to the chains the caller renders so the pager cannot overshoot.
     */
    countOps(accountAddr: string, chainIds: (bigint | string)[]): Promise<number>;
}
export {};
//# sourceMappingURL=accountOpsPersistence.d.ts.map