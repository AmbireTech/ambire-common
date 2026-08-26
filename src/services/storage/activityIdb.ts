import { IActivityOpsBackend, InternalAccountsOps } from '../../interfaces/activity'
import { IStorageController as IStorageControllerType } from '../../interfaces/storage'
import { SubmittedAccountOp, SubmittedAccountOpLike } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import {
  AmbireIdbDatabase,
  invalidateAmbireIdbConnection,
  isClosedConnectionError,
  openAmbireIdb
} from './idbDatabase'
import { IdbAccountOpRow } from './idbSchema'

// Finalized ops loaded per (account, chainId) at startup; pending ops load in full on top.
const STARTUP_RECENT_OPS_LIMIT = 20
/**
 * Hard cap on ops per (account, chainId) group. Enforced twice and the two MUST agree — the
 * controller trims memory, putSingleOp guards the rows — or memory drops ops that storage
 * keeps and every expansion re-adds them.
 */
export const MAX_OPS_PER_GROUP = 1000

// The highest BMP Unicode character — used as a range upper bound to select all keys
// that start with a given prefix, without matching the prefix itself as a key.
const RANGE_HIGH = '￿'

/** An op carrying every field the IDB row and its indexes require. */
type StorableOp = (SubmittedAccountOp | SubmittedAccountOpLike) & {
  id: string
  timestamp: number
  status: AccountOpStatus
}

/**
 * Bulk-write guard for ops from legacy blob storage, which may be missing timestamp or
 * status. Such a row cannot be sorted or indexed, so bulk writes drop it with a warning —
 * losing one unusable op beats failing the whole migration batch.
 *
 * putSingleOp does NOT use this: a live op missing these fields is a bug and must surface.
 */
function isStorableOp(op: SubmittedAccountOp | SubmittedAccountOpLike): op is StorableOp {
  if (typeof op.id !== 'string' || !op.id) {
    console.warn('[ActivityIdbStorage] Skipping op without a valid id', op)
    return false
  }

  if (typeof op.timestamp !== 'number') {
    console.warn(`[ActivityIdbStorage] Skipping op ${op.id} without a valid timestamp`)
    return false
  }

  if (op.status === undefined) {
    console.warn(`[ActivityIdbStorage] Skipping op ${op.id} without a valid status`)
    return false
  }

  return true
}

export class ActivityIdbStorage implements IActivityOpsBackend {
  // Startup reads STARTUP_RECENT_OPS_LIMIT finalized ops per group plus all pending ones.
  readonly loadsPartially = true

  #db: AmbireIdbDatabase

  // Literal, not from the manifest: idb needs it to resolve the row and index types.
  #storeName = 'accountsOps' as const

  #reconnect: () => Promise<AmbireIdbDatabase>

  /**
   * @param db        - The connection opened at startup.
   * @param reconnect - Obtains a fresh connection when the current one dies. The
   *                    default is the openAmbireIdb() singleton, which returns the
   *                    cached connection normally and reopens once blocking() or
   *                    terminated() has dropped it. Overridable for tests.
   */
  constructor(db: AmbireIdbDatabase, reconnect: () => Promise<AmbireIdbDatabase> = openAmbireIdb) {
    this.#db = db
    this.#reconnect = reconnect
  }

  /**
   * Open a transaction, reopening once if the handle turned out to be dead.
   *
   * The handle is captured at construction but can die later — blocking() closes it for an
   * upgrade, and the browser can terminate it. The database survives, so a reopen recovers
   * fully; without this, writes after such a close would be silently lost.
   */
  // Generic over the mode so the transaction keeps its precise type — a widened union makes
  // idb type the write methods as possibly-undefined.
  async #openTx<Mode extends 'readonly' | 'readwrite'>(mode: Mode) {
    try {
      return this.#db.transaction(this.#storeName, mode)
    } catch (error) {
      if (!isClosedConnectionError(error)) throw error

      console.warn('[ActivityIdbStorage] Connection was closed — reopening')
      // Invalidate before reconnecting. blocking()/terminated() drop the cached
      // connection when they fire, but a close can happen without either event —
      // and then openAmbireIdb() would hand back the same dead handle and this
      // retry would fail exactly like the original call.
      invalidateAmbireIdbConnection()
      this.#db = await this.#reconnect()

      return this.#db.transaction(this.#storeName, mode)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────────

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
  async ensureMigrated(
    getStoredOps: () => Promise<InternalAccountsOps>,
    removeStoredOps: () => Promise<void>
  ): Promise<void> {
    const empty = await this.isEmpty()
    if (!empty) return
    const storedOps = await getStoredOps()
    if (Object.keys(storedOps).length === 0) return
    await this.migrateFromStorage(storedOps)
    await removeStoredOps()
  }

  /**
   * Load minimal startup dataset: all pending ops for every account, plus up to
   * STARTUP_RECENT_OPS_LIMIT finalized ops per chain for `finalizedFor` only.
   *
   * Pending ops are needed wallet-wide — broadcastedButNotConfirmed drives which accounts get
   * status polling, and the pending/failed banners are built per account. Finalized ops are
   * only ever rendered for the account being viewed, so fetching them for every account costs
   * (accounts x chains x 20) deserialized rows that nothing reads. Omit `finalizedFor` to get
   * the finalized slice for every account.
   *
   * Two transactions: a key-only cursor enumerates the (account, chainId) groups, then all
   * per-group queries run in parallel inside one transaction. Every per-group request is fired
   * before any await resolves, keeping the tx open.
   */
  async loadStartupOps(finalizedFor?: string): Promise<InternalAccountsOps> {
    // Step 1: enumerate (accountAddr, chainId) groups — key-only cursor, O(N_groups) reads
    const groups: [string, string][] = []
    {
      const tx = await this.#openTx('readonly')
      let cursor = await tx.objectStore(this.#storeName).openKeyCursor()
      while (cursor) {
        const [accountAddr, chainId] = cursor.primaryKey as [string, string, string]
        groups.push([accountAddr, chainId])
        cursor = await cursor.continue([accountAddr, chainId, RANGE_HIGH])
      }
    }

    if (groups.length === 0) return {}

    // Step 2: fetch per-group data — all groups run in parallel within one transaction.
    // Each group's async function fires its IDB requests (1 cursor + 2 getAlls) before
    // the first await resolves, so the transaction always has pending requests.
    const result: InternalAccountsOps = {}
    {
      const tx = await this.#openTx('readonly')
      const store = tx.objectStore(this.#storeName)
      const tsIndex = store.index('by-account-chain-timestamp')
      const statusIndex = store.index('by-account-chain-status')

      await Promise.all(
        groups.map(async ([accountAddr, chainId]) => {
          if (!result[accountAddr]) result[accountAddr] = {}
          if (!result[accountAddr]![chainId]) result[accountAddr]![chainId] = []
          const groupOps = result[accountAddr]![chainId]!

          const tsRange = IDBKeyRange.bound(
            [accountAddr, chainId, 0],
            [accountAddr, chainId, Number.MAX_SAFE_INTEGER]
          )

          const wantsFinalized = !finalizedFor || accountAddr === finalizedFor

          // Run timestamp cursor + 2 pending getAlls in parallel for this group.
          // The getAlls are fired synchronously (before any await), the cursor IIFE
          // fires its first request synchronously too — all 3 are pending at once.
          const [, pendingBroadcasted, pendingQueued] = await Promise.all([
            (async () => {
              if (!wantsFinalized) return

              let finalizedCount = 0
              let cur = await tsIndex.openCursor(tsRange, 'prev')
              while (cur && finalizedCount < STARTUP_RECENT_OPS_LIMIT) {
                const row = cur.value
                const isPending =
                  row.status === AccountOpStatus.BroadcastedButNotConfirmed ||
                  row.status === AccountOpStatus.Pending
                if (!isPending) {
                  groupOps.push(row.op as SubmittedAccountOp)
                  finalizedCount++
                }
                cur = await cur.continue()
              }
            })(),
            statusIndex.getAll(
              IDBKeyRange.only([accountAddr, chainId, AccountOpStatus.BroadcastedButNotConfirmed])
            ),
            statusIndex.getAll(IDBKeyRange.only([accountAddr, chainId, AccountOpStatus.Pending]))
          ])

          for (const row of [...pendingBroadcasted, ...pendingQueued]) {
            groupOps.push(row.op as SubmittedAccountOp)
          }
        })
      )
    }

    // Sort each group descending by timestamp
    for (const chainMap of Object.values(result)) {
      for (const ops of Object.values(chainMap)) {
        ops.sort((a, b) => b.timestamp - a.timestamp)
      }
    }

    return result
  }

  /**
   * Write a single new op and optionally delete the op evicted by the in-memory trim.
   * O(1) IDB operations vs. the full-group rewrite of putMultiple.
   */
  async putSingleOp(
    accountAddr: string,
    chainId: bigint | string,
    op: SubmittedAccountOp,
    trimmedId?: string
  ): Promise<void> {
    const chainIdStr = typeof chainId === 'bigint' ? chainId.toString() : chainId
    const tx = await this.#openTx('readwrite')
    const store = tx.objectStore(this.#storeName)

    // Fire put before any await so the transaction has a pending request.
    // .catch(() => {}) suppresses unhandled-rejection warnings; tx.done still
    // rejects on failure and is awaited below.
    store.put(this.#opToRow(accountAddr, chainIdStr, op)).catch(() => {})

    if (trimmedId) {
      // In-memory trim already identified the op to evict.
      store.delete([accountAddr, chainIdStr, trimmedId]).catch(() => {})
    } else {
      // The in-memory group is within its cap, but IDB may have accumulated more
      // rows than the in-memory limit (e.g. after a startup that only loaded the
      // 20-op subset). Count after the put (IDB serializes requests within a tx)
      // and evict the oldest row when the group exceeds the hard cap.
      const groupRange = IDBKeyRange.bound(
        [accountAddr, chainIdStr, ''],
        [accountAddr, chainIdStr, RANGE_HIGH]
      )
      const count = await store.count(groupRange)
      if (count > MAX_OPS_PER_GROUP) {
        const tsIndex = store.index('by-account-chain-timestamp')
        const cursor = await tsIndex.openCursor(
          IDBKeyRange.bound(
            [accountAddr, chainIdStr, 0],
            [accountAddr, chainIdStr, Number.MAX_SAFE_INTEGER]
          )
        )
        if (cursor) {
          store.delete(cursor.primaryKey).catch(() => {})
        }
      }
    }

    await tx.done
  }

  /**
   * Update existing rows in place (status or balance-change updates).
   * Uses store.put() per op — no range-delete, only touched rows are written.
   */
  async updateOps(ops: SubmittedAccountOp[]): Promise<void> {
    if (ops.length === 0) return

    const tx = await this.#openTx('readwrite')
    const store = tx.objectStore(this.#storeName)

    try {
      for (const op of ops) {
        store.put(this.#opToRow(op.accountAddr, op.chainId.toString(), op)).catch(() => {})
      }
    } catch (error) {
      // Same reasoning as putMultiple: #opToRow throws on an op missing timestamp or
      // status, and without an abort the puts already queued would still commit,
      // leaving some ops updated and the rest silently skipped.
      tx.abort()
      tx.done.catch(() => {})
      throw error
    }

    await tx.done
  }

  /**
   * Fetch all ops for a specific (account, chainId) pair (full history, no limit).
   * Used for lazy-loading older history during pagination.
   * Returns undefined if no ops found (matches existing caller checks).
   */
  async getOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string
  ): Promise<SubmittedAccountOp[] | undefined> {
    const chainIdStr = typeof chainId === 'bigint' ? chainId.toString() : chainId
    const range = IDBKeyRange.bound(
      [accountAddr, chainIdStr, ''],
      [accountAddr, chainIdStr, RANGE_HIGH]
    )
    // Goes through #openTx rather than the db.getAll() shortcut so a dead
    // connection is recovered here too.
    const tx = await this.#openTx('readonly')
    const rows = await tx.objectStore(this.#storeName).getAll(range)

    if (rows.length === 0) return undefined

    rows.sort((a, b) => b.timestamp - a.timestamp)
    return rows.map((r) => r.op as SubmittedAccountOp)
  }

  /**
   * Batch write multiple (account, chainId) pairs in a single transaction.
   * Existing rows for each pair are deleted first, then the new ops inserted.
   */
  async putMultiple(
    records: Array<{
      accountAddr: string
      chainId: bigint | string
      ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
    }>
  ): Promise<void> {
    // Nothing to write — skip opening a transaction at all. Mirrors updateOps.
    if (records.length === 0) return

    const tx = await this.#openTx('readwrite')
    const store = tx.objectStore(this.#storeName)

    try {
      for (const { accountAddr, chainId, ops } of records) {
        const chainIdStr = typeof chainId === 'bigint' ? chainId.toString() : chainId
        this.#writeRecordToStore(store, accountAddr, chainIdStr, this.#dedupeOpsById(ops))
      }
    } catch (error) {
      // Without this abort, requests already queued in the loop would still
      // commit, leaving a partially written store. During migration that is
      // unrecoverable: isEmpty() would report false and the ensureMigrated guard
      // would skip the retry forever, stranding the rest of the user's history in
      // the legacy key. Aborting keeps the batch all-or-nothing.
      tx.abort()
      // tx.done rejects with the abort; nobody awaits it on this path.
      tx.done.catch(() => {})
      throw error
    }

    await tx.done
  }

  /**
   * Delete all ops for an account across all chains.
   */
  async deleteAccount(accountAddr: string): Promise<void> {
    const range = IDBKeyRange.bound([accountAddr, '', ''], [accountAddr, RANGE_HIGH, RANGE_HIGH])
    const tx = await this.#openTx('readwrite')
    await tx.objectStore(this.#storeName).delete(range)
    await tx.done
  }

  /**
   * One getAll rather than a query per group — only used by the one-time recipient backfill,
   * where a single large read beats N round trips.
   */
  async getAllOps(): Promise<InternalAccountsOps> {
    const tx = await this.#openTx('readonly')
    const rows = await tx.objectStore(this.#storeName).getAll()

    const result: InternalAccountsOps = {}
    for (const row of rows) {
      if (!result[row.accountAddr]) result[row.accountAddr] = {}
      if (!result[row.accountAddr]![row.chainId]) result[row.accountAddr]![row.chainId] = []
      result[row.accountAddr]![row.chainId]!.push(row.op as SubmittedAccountOp)
    }

    return result
  }

  /**
   * Count every row for an account across all chains.
   *
   * count() on a key range is served from the index structure without reading or
   * deserializing any record, so this stays cheap even for a heavy account.
   */
  async countOpsForAccount(accountAddr: string): Promise<number> {
    const range = IDBKeyRange.bound([accountAddr, '', ''], [accountAddr, RANGE_HIGH, RANGE_HIGH])
    const tx = await this.#openTx('readonly')

    return tx.objectStore(this.#storeName).count(range)
  }

  /**
   * One-time migration: import all ops from legacy blob storage into IDB.
   * After successful import, the caller should remove the key from legacy storage.
   */
  async migrateFromStorage(data: InternalAccountsOps): Promise<void> {
    const records = Object.entries(data).flatMap(([accountAddr, chainMap]) =>
      Object.entries(chainMap).map(([chainId, ops]) => ({ accountAddr, chainId, ops }))
    )
    return this.putMultiple(records)
  }

  /**
   * Check if IDB has any data (used to detect if migration is needed).
   */
  async isEmpty(): Promise<boolean> {
    const tx = await this.#openTx('readonly')
    const count = await tx.objectStore(this.#storeName).count()
    return count === 0
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────────

  #writeRecordToStore(
    store: any,
    accountAddr: string,
    chainIdStr: string,
    ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
  ): void {
    // Delete existing rows for this (account, chain), then insert fresh ones
    store
      .delete(
        IDBKeyRange.bound([accountAddr, chainIdStr, ''], [accountAddr, chainIdStr, RANGE_HIGH])
      )
      .catch(() => {})
    for (const op of ops) {
      store.put(this.#opToRow(accountAddr, chainIdStr, op)).catch(() => {})
    }
  }

  // Drops ops that cannot be stored, then collapses duplicate ids keeping the
  // last occurrence. Runs before any write so a bad row never reaches #opToRow,
  // whose throw would abandon the batch mid-transaction.
  #dedupeOpsById(ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]): StorableOp[] {
    const deduped = new Map<string, StorableOp>()

    for (const op of ops) {
      if (!isStorableOp(op)) continue

      deduped.set(op.id, op)
    }

    return Array.from(deduped.values())
  }

  #opToRow(
    accountAddr: string,
    chainIdStr: string,
    op: SubmittedAccountOp | SubmittedAccountOpLike
  ): IdbAccountOpRow {
    if (typeof op.id !== 'string' || !op.id) {
      throw new Error('[ActivityIdbStorage] Cannot store op without a valid id')
    }

    if (typeof op.timestamp !== 'number') {
      throw new Error(`[ActivityIdbStorage] Cannot store op ${op.id} without a valid timestamp`)
    }

    if (op.status === undefined) {
      throw new Error(`[ActivityIdbStorage] Cannot store op ${op.id} without a valid status`)
    }

    return {
      accountAddr,
      chainId: chainIdStr,
      id: op.id,
      timestamp: op.timestamp,
      status: op.status,
      op
    }
  }
}

/**
 * chrome.storage.local–backed persistence for AccountsOps.
 * Used in environments without IndexedDB support (mobile).
 * Writes the full in-memory ops blob on every mutation — no row-level granularity.
 */
export class ActivityKeyValueStorage implements IActivityOpsBackend {
  // One blob, read whole — there is no window to expand past.
  readonly loadsPartially = false

  #storage: IStorageControllerType
  #getOps: () => InternalAccountsOps

  /**
   * @param storage - The storage controller to read/write from.
   * @param getOps  - Returns the controller's current in-memory AccountsOps so
   *                  write methods can persist the full up-to-date blob.
   */
  constructor(storage: IStorageControllerType, getOps: () => InternalAccountsOps) {
    this.#storage = storage
    this.#getOps = getOps
  }

  // Migration is not needed for storage — data is already in storage.
  async ensureMigrated(_g: () => Promise<InternalAccountsOps>, _r: () => Promise<void>) {}

  // The blob is read whole, so there is no per-account slice to skip.
  async loadStartupOps(_finalizedFor?: string): Promise<InternalAccountsOps> {
    return this.#storage.get('accountsOps', {})
  }

  async putSingleOp(
    _accountAddr: string,
    _chainId: bigint | string,
    _op: SubmittedAccountOp,
    _trimmedId?: string
  ): Promise<void> {
    await this.#storage.set('accountsOps', this.#getOps())
  }

  async updateOps(_ops: SubmittedAccountOp[]): Promise<void> {
    await this.#storage.set('accountsOps', this.#getOps())
  }

  async getOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string
  ): Promise<SubmittedAccountOp[] | undefined> {
    const chainIdStr = typeof chainId === 'bigint' ? chainId.toString() : chainId
    const ops = this.#getOps()[accountAddr]?.[chainIdStr]
    if (!ops?.length) return undefined
    return [...ops].sort((a, b) => b.timestamp - a.timestamp)
  }

  async deleteAccount(_accountAddr: string): Promise<void> {
    await this.#storage.set('accountsOps', this.#getOps())
  }

  /** The in-memory blob already IS every stored op. */
  async getAllOps(): Promise<InternalAccountsOps> {
    return this.#getOps()
  }

  /**
   * On this backend the in-memory blob IS the complete history, so summing the group
   * lengths is already the true total.
   */
  async countOpsForAccount(accountAddr: string): Promise<number> {
    const chainMap = this.#getOps()[accountAddr]
    if (!chainMap) return 0

    return Object.values(chainMap).reduce((total, ops) => total + (ops?.length ?? 0), 0)
  }
}
