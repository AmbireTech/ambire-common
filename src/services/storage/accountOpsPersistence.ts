import { IActivityOpsBackend, InternalAccountsOps } from '../../interfaces/activity'
import { IStorageController } from '../../interfaces/storage'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { ActivityIdbStorage, ActivityKeyValueStorage } from './activityIdb'
import { AmbireIdbDatabase } from './idbDatabase'

export interface PersistenceError {
  message: string
  error: Error
}

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
  onError: (e: PersistenceError) => void
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

  #onError: (e: PersistenceError) => void

  // (account, chainId) groups expanded to full history this session, keyed `${addr}:${chainId}`.
  // Must be an explicit flag, not a length check: pending ops are exempt from the startup
  // cap, so a group can exceed the window without having been expanded.
  #fullyLoadedGroups = new Set<string>()

  // Total op count per account, for callers that need a true total synchronously. Only used with
  // a partially-loading adapter; otherwise the cache is the whole history and is summed live.
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
  async init(): Promise<InternalAccountsOps> {
    const migrated = await this.#migrate()

    // A failed migration leaves the target empty while the retained legacy blob still holds
    // everything, so this session behaves like a pre-migration one and reads AND writes the
    // legacy key. Continuing to write to IDB would put a row into the empty store, making
    // the isEmpty() guard skip the retry forever and stranding the real history.
    if (!migrated) this.#fallBackToKeyValue()

    return this.#loadStartupOps()
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

  /** Whether the active adapter loads only a window at startup rather than everything. */
  get loadsPartially(): boolean {
    return this.#adapter.loadsPartially
  }

  /**
   * Expand the given accounts from the startup window to their full history, for callers
   * that must reason over every past op rather than the recent slice.
   */
  async ensureFullHistory(accountAddrs: string[]): Promise<void> {
    if (!this.loadsPartially) return

    await Promise.all(accountAddrs.map((addr) => this.#expandAccount(addr)))
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

      // Marked even on an empty result: undefined means this group has no history to
      // expand, not that expanding failed. Only marking on a hit would re-query on every
      // call for any chain the account has never used. A real failure throws below.
      this.#markGroupLoaded(accountAddr, chainIdStr)
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
    // Cleared first so a failed delete cannot leave stale markers behind claiming the
    // account's history is loaded and counted.
    for (const key of this.#fullyLoadedGroups) {
      if (key.startsWith(`${accountAddr}:`)) this.#fullyLoadedGroups.delete(key)
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
    // With a fully-loading adapter the cache IS the whole history, so a live sum is exact
    // and free — a stored count could only ever be staler.
    if (!this.loadsPartially) return this.#countInCache(accountAddr)

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
        // The legacy key is kept as a safety-net copy while IDB is still new; only the
        // completion flag is recorded in place of removing it.
        async () => this.#setMigratedFlag(true)
      )

      return true
    } catch (error) {
      // Non-fatal: the legacy key is intact, this session reads from it, and the next
      // startup retries. The user sees their history either way.
      this.#report(
        'Your transaction history could not be moved to its new location.',
        error,
        'migrate to IDB'
      )

      return false
    }
  }

  #fallBackToKeyValue(): void {
    if (!this.loadsPartially) return

    this.#adapter = new ActivityKeyValueStorage(this.#storage, this.#getCache)
  }

  async #loadStartupOps(): Promise<InternalAccountsOps> {
    try {
      return await this.#adapter.loadStartupOps()
    } catch (error) {
      // Degrading to empty keeps the controller usable; the data is untouched on disk and
      // the next startup reads it again.
      this.#report('Your transaction history could not be loaded.', error, 'read startup ops')

      return {}
    }
  }

  /**
   * Record that this wallet's history lives in IDB.
   *
   * Nothing reads the flag yet. It is written anyway because it can only be recorded while
   * IDB works — a session that cannot open IDB can no longer tell "never had transactions"
   * from "history is in IDB and unreachable".
   *
   * A second writer is needed because ensureMigrated only sets it after moving a legacy
   * blob, which never happens for users who installed after IDB became the default. Gated
   * on there being ops, so a brand-new empty wallet is not marked as migrated.
   */
  async #recordMigrationCompleted(ops: InternalAccountsOps): Promise<void> {
    if (!this.loadsPartially) return
    if (!Object.keys(ops).length) return

    try {
      if (await this.#getMigratedFlag()) return
      await this.#setMigratedFlag(true)
    } catch (error) {
      this.#report('Your transaction history could not be checked.', error, 'record the flag')
    }
  }

  // 'activityIdbMigrated' is intentionally NOT part of the shared StorageProps schema
  // (interfaces/storage.ts) — it is a provisional detail of the ongoing accountsOps → IDB
  // migration. get()/set() are typed against StorageProps, so each needs one narrow cast.
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
   * Expand every chain of one account.
   *
   * Only chains already in the cache are fetched, since loadStartupOps() enumerates every
   * non-empty group. An account with no chains is deliberately NOT marked loaded —
   * otherwise a failed startup read would convince us there is nothing to expand.
   */
  async #expandAccount(accountAddr: string): Promise<void> {
    if (!accountAddr) return

    const chainIds = Object.keys(this.#getCache()[accountAddr] ?? {}).filter(
      (chainId) => !this.#isGroupLoaded(accountAddr, chainId)
    )
    if (!chainIds.length) return

    try {
      const groups = await Promise.all(
        chainIds.map(async (chainId) => ({
          chainId,
          ops: await this.#adapter.getOpsForAccountAndChain(accountAddr, chainId)
        }))
      )

      // Re-read: the account may have been removed while the reads were in flight.
      if (!this.#getCache()[accountAddr]) return

      for (const { chainId, ops } of groups) {
        if (ops?.length) this.#mergeIntoCache(accountAddr, chainId, ops)
        this.#markGroupLoaded(accountAddr, chainId)
      }
    } catch (error) {
      this.#report('Part of your transaction history could not be loaded.', error, 'expand account')
    }
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

  #isGroupLoaded(accountAddr: string, chainId: string): boolean {
    // A fully-loading adapter has everything already, so every group is loaded by definition
    if (!this.loadsPartially) return true

    return this.#fullyLoadedGroups.has(`${accountAddr}:${chainId}`)
  }

  #markGroupLoaded(accountAddr: string, chainId: string): void {
    this.#fullyLoadedGroups.add(`${accountAddr}:${chainId}`)
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
    if (!this.loadsPartially) return

    await Promise.all(Object.keys(ops).map((addr) => this.#refreshCount(addr)))
  }

  async #refreshCount(accountAddr: string): Promise<void> {
    // Nothing to store when the cache is already the whole history.
    if (!this.loadsPartially) return

    try {
      this.#totalOpsCount.set(accountAddr, await this.#adapter.countOpsForAccount(accountAddr))
    } catch (error) {
      // Leave the previous value; getTotalOpsCount falls back to the cache sum if unset.
      this.#report('The transaction count could not be refreshed.', error, 'count ops')
    }
  }

  #report(message: string, error: unknown, what: string): void {
    this.#onError({
      message,
      error: error instanceof Error ? error : new Error(`AccountOpsPersistence: failed to ${what}`)
    })
  }
}
