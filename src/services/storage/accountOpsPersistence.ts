import { IActivityOpsBackend, InternalAccountsOps } from '../../interfaces/activity'
import { IStorageController } from '../../interfaces/storage'
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

  // Must be a flag, not a length check: pending ops are exempt from the startup cap, so a
  // group can exceed the window without having been expanded.
  #fullyLoadedGroups = new Set<string>()

  // Only used with a partially-loading adapter; otherwise the cache is summed live.
  #totalOpsCount = new Map<string, number>()

  constructor({ storage, idb, getCache, onError }: AccountOpsPersistenceParams) {
    this.#storage = storage
    this.#getCache = getCache
    this.#onError = onError
    this.#adapter = this.#pickAdapter(idb)
  }

  #pickAdapter(idb?: AmbireIdbDatabase): IActivityOpsBackend {
    if (idb) return new ActivityIdbStorage(idb)

    return new ActivityKeyValueStorage(this.#storage, this.#getCache)
  }

  /**
   * Migrate if needed, then return the dataset to start the session with.
   *
   * The migration must complete before the read, or the read would observe an empty store
   * while the migration is still in flight.
   *
   * Deliberately does NOT do the post-load bookkeeping — see finalizeInit().
   */
  async init(finalizedFor?: string): Promise<InternalAccountsOps> {
    const migrated = await this.#migrate()

    // Reads AND writes must both go to the legacy key. Writing to IDB while reading the blob
    // would put a row in the empty store, making isEmpty() skip the retry forever.
    if (!migrated) this.#fallBackToKeyValue()

    return this.#loadStartupOps(finalizedFor)
  }

  /**
   * Bookkeeping that nothing renders: record the migration flag and warm the op counts.
   *
   * Split out of init() so the caller can emit its first update BEFORE this runs. Counting
   * costs one backend query per account, and no UI waits on the result — folding it into
   * init() would delay the first paint of the history for no benefit.
   */
  async finalizeInit(ops: InternalAccountsOps): Promise<void> {
    await this.#recordMigrationCompleted(ops)
    await this.#refreshAllCounts(ops)
  }

  /**
   * Every stored op, for the one-time recipient backfill. Never rejects; an empty result
   * means the caller must not record the backfill as done.
   */
  async getAllOps(): Promise<InternalAccountsOps | null> {
    try {
      return await this.#adapter.getAllOps()
    } catch (error) {
      this.#report('Your transaction history could not be read.', error, 'read all ops')

      return null
    }
  }

  /**
   * Expand one (account, chain) group, for pagination past the startup window.
   *
   * On failure the group stays unmarked and the cache keeps the startup window — a subset
   * rather than wrong data — so the caller can always page over whatever is there.
   */
  async ensureGroupLoaded(accountAddr: string, chainId: bigint | string): Promise<void> {
    const chainIdStr = chainId.toString()
    if (this.#isGroupLoaded(accountAddr, chainIdStr)) return

    try {
      const fullOps = await this.#adapter.getOpsForAccountAndChain(accountAddr, chainId)
      if (fullOps) this.#mergeIntoCache(accountAddr, chainIdStr, fullOps)

      // Marked even when empty: undefined means nothing to expand, not a failure. Marking
      // only on a hit would re-query every call for chains the account never used.
      this.#fullyLoadedGroups.add(this.#groupKey(accountAddr, chainIdStr))
    } catch (error) {
      this.#report('Older transactions could not be loaded.', error, 'expand a group')
    }
  }

  /** Persist one new op, and delete the op the caller's in-memory trim evicted. */
  async addOp(
    accountAddr: string,
    chainId: bigint | string,
    op: SubmittedAccountOp,
    trimmedId?: string
  ): Promise<void> {
    try {
      await this.#adapter.putSingleOp(accountAddr, chainId, op, trimmedId)
    } catch (error) {
      this.#report('Your latest transaction could not be saved to your history.', error, 'add op')
    }

    // Recounted, not incremented: putSingleOp may have evicted a row, making this net-zero.
    await this.#refreshCount(accountAddr)
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
    // First, so a failed delete cannot leave markers claiming the history is loaded.
    for (const key of this.#fullyLoadedGroups) {
      if (key.startsWith(this.#groupKey(accountAddr))) this.#fullyLoadedGroups.delete(key)
    }
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

  /**
   * Total transactions an account has ever made. Synchronous because the consumer
   * (BannerController's txn thresholds) evaluates inside a sync callback.
   */
  getTotalOpsCount(accountAddr: string): number {
    // The cache IS the whole history here, so a stored count could only ever be staler.
    if (!this.#adapter.loadsPartially) return this.#countInCache(accountAddr)

    return this.#totalOpsCount.get(accountAddr) ?? this.#countInCache(accountAddr)
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * @returns false only if the migration failed, meaning the target is empty and must not
   *          be read from. True on success and where it is a no-op.
   */
  async #migrate(): Promise<boolean> {
    try {
      await this.#adapter.ensureMigrated(
        () => this.#storage.get('accountsOps', {}),
        // Kept as a safety-net copy; the flag is recorded instead of removing it.
        async () => this.#setMigratedFlag(true)
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

  /**
   * Record that this wallet's history lives in IDB.
   *
   * Nothing reads the flag yet — it is written because it can only be recorded while IDB
   * works. A second writer is needed because ensureMigrated only sets it after moving a legacy
   * blob, which never happens for users who installed after IDB became the default.
   */
  async #recordMigrationCompleted(ops: InternalAccountsOps): Promise<void> {
    if (!this.#adapter.loadsPartially) return
    if (!Object.keys(ops).length) return

    try {
      if (await this.#getMigratedFlag()) return
      await this.#setMigratedFlag(true)
    } catch (error) {
      this.#report('Your transaction history could not be checked.', error, 'record the flag')
    }
  }

  // Deliberately not in StorageProps — a provisional migration detail, hence the casts.
  #getMigratedFlag(): Promise<boolean> {
    return (this.#storage.get as (key: string, defaultValue: boolean) => Promise<boolean>)(
      'activityIdbMigrated',
      false
    )
  }

  #setMigratedFlag(value: boolean): Promise<void> {
    return (this.#storage.set as (key: string, value: boolean) => Promise<void>)(
      'activityIdbMigrated',
      value
    )
  }

  /**
   * Merge fetched rows into the cache, keeping the CACHED object on an id collision.
   *
   * A merge and not a replace, because the cache can hold ops the backend does not have yet
   * (a just-broadcast op lands in memory before the write) and objects that in-flight work
   * still mutates (status updates mutate across provider awaits). Replacing would drop the
   * first and detach the second.
   */
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

  /** Marker key. With no chainId this is the prefix removeAccount clears by. */
  #groupKey(accountAddr: string, chainId = ''): string {
    return `${accountAddr}:${chainId}`
  }

  #isGroupLoaded(accountAddr: string, chainId: string): boolean {
    // A fully-loading adapter has everything already, so every group is loaded by definition
    if (!this.#adapter.loadsPartially) return true

    return this.#fullyLoadedGroups.has(this.#groupKey(accountAddr, chainId))
  }

  #countInCache(accountAddr: string): number {
    return Object.values(this.#getCache()[accountAddr] ?? {}).reduce(
      (total, ops) => total + (ops?.length ?? 0),
      0
    )
  }

  /**
   * Only accounts present in the startup dataset are counted: loadStartupOps() enumerates
   * every non-empty group, so an absent account has no ops and the cache sum of 0 is right.
   */
  async #refreshAllCounts(ops: InternalAccountsOps): Promise<void> {
    if (!this.#adapter.loadsPartially) return

    await Promise.all(Object.keys(ops).map((addr) => this.#refreshCount(addr)))
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
