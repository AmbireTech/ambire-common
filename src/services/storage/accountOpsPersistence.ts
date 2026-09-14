import { IActivityOpsBackend, InternalAccountsOps } from '../../interfaces/activity'
import { IStorageController, StorageProps } from '../../interfaces/storage'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { ActivityIdbStorage, ActivityKeyValueStorage } from './activityIdb'
import { AmbireIdbDatabase } from './idbDatabase'
import { ReportPersistenceError, toPersistenceError } from './persistenceError'

interface AccountOpsPersistenceParams {
  storage: IStorageController
  /** The connection opened at startup, or undefined where IDB does not exist (mobile). */
  idb?: AmbireIdbDatabase
  /**
   * The controller's live in-memory ops. Expansion writes merged groups back into it, and
   * the key-value adapter serializes it on every write.
   */
  getCache: () => InternalAccountsOps
  /** Reported instead of thrown — every method here degrades rather than failing a caller. */
  onError: ReportPersistenceError
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
export class AccountOpsPersistence {
  #adapter: IActivityOpsBackend

  #storage: IStorageController

  #getCache: () => InternalAccountsOps

  #onError: ReportPersistenceError

  // Only used with a partially-loading adapter; otherwise the cache is summed live.
  #totalOpsCount = new Map<string, number>()

  constructor({ storage, idb, getCache, onError }: AccountOpsPersistenceParams) {
    this.#storage = storage
    this.#getCache = getCache
    this.#onError = onError
    this.#adapter = this.#pickAdapter(idb)
  }

  #activeBackend: StorageProps['activityStorageBackend'] = 'keyValue'

  #pickAdapter(idb?: AmbireIdbDatabase): IActivityOpsBackend {
    if (idb) {
      this.#activeBackend = 'idb'

      return new ActivityIdbStorage(idb)
    }

    return new ActivityKeyValueStorage(this.#storage, this.#getCache)
  }

  /** Migrate if needed, then return the startup dataset. Bookkeeping is in finalizeInit(). */
  async init(finalizedFor?: string): Promise<InternalAccountsOps> {
    const migrated = await this.#migrate()

    // Reads AND writes must both go to the legacy key. Writing to IDB while reading the blob
    // would put a row in the empty store, making isEmpty() skip the retry forever.
    if (!migrated) this.#fallBackToKeyValue()

    return this.#loadStartupOps(finalizedFor)
  }

  /** Bookkeeping nothing renders, so the caller can paint before paying for it. */
  async finalizeInit(ops: InternalAccountsOps): Promise<void> {
    await this.#recordActiveBackend(ops)
    await this.#refreshAllCounts(ops)
  }

  /**
   * Merge each chain's newest `limit` ops into the cache, so one page costs one read per chain.
   */
  async ensureRecentLoaded(
    accountAddr: string,
    limit: number,
    chainIds: (bigint | string)[]
  ): Promise<void> {
    if (!this.#adapter.loadsPartially) return

    await Promise.all(
      chainIds.map(async (chainId) => {
        try {
          const ops = await this.#adapter.getRecentOps(accountAddr, limit, chainId)
          if (ops.length) this.#mergeIntoCache(accountAddr, chainId.toString(), ops)
        } catch (error) {
          this.#report('Older transactions could not be loaded.', error, 'load a page')
        }
      })
    )
  }

  /**
   * Whether the account already stores an op carrying this txnId.
   *
   * @returns true when the lookup fails, so a caller guarding against duplicates treats
   *          "unknown" as "present" — a stored duplicate is permanent, a skipped op is not.
   */
  async hasOpWithTxnId(accountAddr: string, txnId: string): Promise<boolean> {
    try {
      return await this.#adapter.hasOpWithTxnId(accountAddr, txnId)
    } catch (error) {
      this.#report('Your transaction history could not be checked.', error, 'look up a txn id')

      return true
    }
  }

  /** Persist one new op, and delete the op the caller's in-memory trim evicted. */
  async addOp(
    accountAddr: string,
    chainId: bigint | string,
    op: SubmittedAccountOp,
    trimmedId?: string
  ): Promise<void> {
    let delta = 0

    try {
      delta = await this.#adapter.putSingleOp(accountAddr, chainId, op, trimmedId)
    } catch (error) {
      // Left at 0: a rejected write means the transaction aborted, so no row was committed.
      this.#report('Your latest transaction could not be saved to your history.', error, 'add op')
    }

    // Adjusted by the delta the write reports, so adding an op costs no extra read. Only when
    // a count is already cached — otherwise getTotalOpsCount falls back to the cache sum.
    const cached = this.#totalOpsCount.get(accountAddr)
    if (delta && cached !== undefined) this.#totalOpsCount.set(accountAddr, cached + delta)
  }

  async updateOps(ops: SubmittedAccountOp[]): Promise<void> {
    try {
      await this.#adapter.updateOps(ops)
    } catch (error) {
      this.#report('Some transaction updates could not be saved.', error, 'update ops')
    }
  }

  /** Drop an account's rows and every marker keyed to it. */
  async removeAccount(accountAddr: string): Promise<void> {
    this.#totalOpsCount.delete(accountAddr)

    try {
      await this.#adapter.deleteAccount(accountAddr)
    } catch (error) {
      this.#report(
        "Some of the removed account's transaction history could not be deleted.",
        error,
        'delete account'
      )
    }
  }

  /** Total ops ever. Synchronous because BannerController evaluates inside a sync callback. */
  getTotalOpsCount(accountAddr: string): number {
    // The cache IS the whole history here, so a stored count could only ever be staler.
    if (!this.#adapter.loadsPartially) return this.#countInCache(accountAddr)

    return this.#totalOpsCount.get(accountAddr) ?? this.#countInCache(accountAddr)
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────────────

  /** @returns false only on failure, meaning the target is empty and must not be read. */
  async #migrate(): Promise<boolean> {
    try {
      await this.#adapter.ensureMigrated(
        () => this.#storage.get('accountsOps', {}),
        // Deliberately a no-op: the legacy key is kept as a safety-net copy.
        async () => {}
      )

      return true
    } catch (error) {
      // Non-fatal: the legacy key is intact and the next startup retries.
      this.#report(
        'Your transaction history could not be moved to its new location.',
        error,
        'migrate to IDB'
      )

      return false
    }
  }

  #fallBackToKeyValue(): void {
    if (!this.#adapter.loadsPartially) return

    this.#activeBackend = 'keyValue'
    this.#adapter = new ActivityKeyValueStorage(this.#storage, this.#getCache)
  }

  async #loadStartupOps(finalizedFor?: string): Promise<InternalAccountsOps> {
    try {
      return await this.#adapter.loadStartupOps(finalizedFor)
    } catch (error) {
      // Degrading to empty keeps the controller usable; the data is untouched on disk.
      this.#report('Your transaction history could not be loaded.', error, 'read startup ops')

      return {}
    }
  }

  /** Record which backend holds the history — only recordable while that backend works. */
  async #recordActiveBackend(ops: InternalAccountsOps): Promise<void> {
    // Only once there is history to lose. Recording a backend for an empty wallet would make
    // the stranded check below fire at a user who never had a transaction.
    if (!Object.keys(ops).length) return

    try {
      // Defaulted to null, not to the current backend — otherwise the comparison below is
      // always equal on a first run and the value never gets written.
      const previous = await this.#storage.get('activityStorageBackend', null)

      // Written to IndexedDB last session, key-value this one: the history is in a store this
      // session cannot open. The retained legacy blob keeps the wallet usable, but it is
      // frozen at migration time, so what the user sees is missing everything written since.
      if (previous === 'idb' && this.#activeBackend === 'keyValue') {
        this.#report(
          'Some of your recent transactions could not be loaded.',
          new Error('AccountOpsPersistence: IDB unavailable after history was written to it'),
          'reach the transaction history'
        )
      }

      if (previous !== this.#activeBackend) {
        await this.#storage.set('activityStorageBackend', this.#activeBackend)
      }
    } catch (error) {
      this.#report('Your transaction history could not be checked.', error, 'record the backend')
    }
  }

  /** Merge, not replace: the cache holds unwritten ops and objects in-flight work still mutates. */
  #mergeIntoCache(accountAddr: string, chainId: string, fetched: SubmittedAccountOp[]): void {
    const cache = this.#getCache()
    if (!cache[accountAddr]) cache[accountAddr] = {}

    const cached = cache[accountAddr]![chainId]
    if (!cached?.length) {
      cache[accountAddr]![chainId] = [...fetched]

      return
    }

    const byId = new Map<string, SubmittedAccountOp>()
    for (const op of fetched) byId.set(op.id, op)
    for (const op of cached) byId.set(op.id, op)

    cache[accountAddr]![chainId] = Array.from(byId.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    )
  }

  #countInCache(accountAddr: string): number {
    return Object.values(this.#getCache()[accountAddr] ?? {}).reduce(
      (total, ops) => total + (ops?.length ?? 0),
      0
    )
  }

  /** Startup accounts only — loadStartupOps() lists every non-empty group, so absent means zero. */
  async #refreshAllCounts(ops: InternalAccountsOps): Promise<void> {
    if (!this.#adapter.loadsPartially) return

    await Promise.all(Object.keys(ops).map((addr) => this.#refreshCount(addr)))
  }

  /**
   * Exact stored count, scoped to the chains the caller renders so the pager cannot overshoot.
   */
  async countOps(accountAddr: string, chainIds: (bigint | string)[]): Promise<number> {
    try {
      const counts = await Promise.all(
        chainIds.map((chainId) => this.#adapter.countOpsForAccount(accountAddr, chainId))
      )

      return counts.reduce((total, count) => total + count, 0)
    } catch (error) {
      this.#report('Your transaction history could not be counted.', error, 'count ops')

      return 0
    }
  }

  async #refreshCount(accountAddr: string): Promise<void> {
    // Nothing to store when the cache is already the whole history.
    if (!this.#adapter.loadsPartially) return

    try {
      this.#totalOpsCount.set(accountAddr, await this.#adapter.countOpsForAccount(accountAddr))
    } catch (error) {
      // Leave the previous value; getTotalOpsCount falls back to the cache sum if unset.
      this.#report('The transaction count could not be refreshed.', error, 'count ops')
    }
  }

  #report(message: string, error: unknown, what: string): void {
    this.#onError(toPersistenceError(message, error, `AccountOpsPersistence: failed to ${what}`))
  }
}
