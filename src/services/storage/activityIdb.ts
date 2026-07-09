import { IActivityIdbStorage, InternalAccountsOps } from '../../interfaces/activity'
import { SubmittedAccountOp, SubmittedAccountOpLike } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { BaseIdbStore } from './baseIdbStore'

const STARTUP_RECENT_OPS_LIMIT = 20
// Hard cap on the number of IDB rows per (account, chainId) group.
// The in-memory cap is enforced by ActivityController; this guards against IDB
// accumulating more rows than the in-memory limit (e.g. after a startup that
// loaded only the 20-op subset before the limit was enforced).
const MAX_IDB_GROUP_SIZE = 1000

interface IdbAccountOpRow {
  accountAddr: string
  // String copy of op.chainId — BigInt is not a valid IDB key type so it cannot
  // be used directly in the compound keyPath or index keys.
  chainId: string
  id: string
  timestamp: number
  status: AccountOpStatus
  // The full op is stored via the Structured Clone Algorithm, which preserves
  // BigInt natively — no JSON serialization needed.
  op: SubmittedAccountOp | SubmittedAccountOpLike
}

// The highest BMP Unicode character — used as a range upper bound to select all keys
// that start with a given prefix, without matching the prefix itself as a key.
const RANGE_HIGH = '￿'

export class ActivityIdbStorage extends BaseIdbStore implements IActivityIdbStorage {
  constructor() {
    super({
      dbName: 'ambire',
      storeName: 'accountsOps',
      keyPath: ['accountAddr', 'chainId', 'id'],
      dbVersion: 1,
      indexes: [
        { name: 'by-account-chain-timestamp', keyPath: ['accountAddr', 'chainId', 'timestamp'] },
        { name: 'by-account-chain-status', keyPath: ['accountAddr', 'chainId', 'status'] }
      ]
    })
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * Load minimal startup dataset: all pending ops + up to STARTUP_RECENT_OPS_LIMIT
   * finalized ops per (account, chain).
   *
   * Two transactions:
   *   1. Key-only cursor enumerates (accountAddr, chainId) groups — O(N_groups) reads.
   *   2. Per-group queries run in parallel within one transaction:
   *      - 'by-account-chain-timestamp' cursor (prev) → top N finalized, stops early
   *      - 'by-account-chain-status' getAll × 2 → all pending ops
   *
   * All per-group requests are fired before any await resolves, keeping the
   * transaction open for the duration.
   */
  async loadStartupOps(): Promise<InternalAccountsOps> {
    await this.init()
    const db = this.db!

    // Step 1: enumerate (accountAddr, chainId) groups — key-only cursor, O(N_groups) reads
    const groups: [string, string][] = []
    {
      const tx = db.transaction(this.config.storeName, 'readonly')
      let cursor = await tx.objectStore(this.config.storeName).openKeyCursor()
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
      const tx = db.transaction(this.config.storeName, 'readonly')
      const store = tx.objectStore(this.config.storeName)
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

          // Run timestamp cursor + 2 pending getAlls in parallel for this group.
          // The getAlls are fired synchronously (before any await), the cursor IIFE
          // fires its first request synchronously too — all 3 are pending at once.
          const [, pendingBroadcasted, pendingQueued] = await Promise.all([
            (async () => {
              let finalizedCount = 0
              let cur = await tsIndex.openCursor(tsRange, 'prev')
              while (cur && finalizedCount < STARTUP_RECENT_OPS_LIMIT) {
                const row = cur.value as IdbAccountOpRow
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

          for (const row of [...pendingBroadcasted, ...pendingQueued] as IdbAccountOpRow[]) {
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

    console.log(`[ActivityIdbStorage] loadStartupOps: ${groups.length} groups loaded`)
    return result
  }

  /**
   * Write a single new op and optionally delete the op evicted by the in-memory trim.
   * O(1) IDB operations vs. the full-group rewrite of putOpsForAccountAndChain.
   */
  async putSingleOp(
    accountAddr: string,
    chainId: bigint | string,
    op: SubmittedAccountOp,
    trimmedId?: string
  ): Promise<void> {
    await this.init()
    const chainIdStr = typeof chainId === 'bigint' ? chainId.toString() : chainId
    const tx = this.db!.transaction(this.config.storeName, 'readwrite')
    const store = tx.objectStore(this.config.storeName)

    // Fire put before any await so the transaction has a pending request.
    // .catch(() => {}) suppresses unhandled-rejection warnings; tx.done still
    // rejects on failure and is awaited below.
    console.log(`[ActivityIdbStorage] putSingleOp ${accountAddr}:${chainIdStr} op=${op.id}`)
    store.put(this.#opToRow(accountAddr, chainIdStr, op)).catch(() => {})

    if (trimmedId) {
      // In-memory trim already identified the op to evict.
      console.log(
        `[ActivityIdbStorage] putSingleOp evicting in-memory trimmed op=${trimmedId} for ${accountAddr}:${chainIdStr}`
      )
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
      console.log(
        `[ActivityIdbStorage] putSingleOp IDB group size after put: ${count} for ${accountAddr}:${chainIdStr}`
      )
      if (count > MAX_IDB_GROUP_SIZE) {
        const tsIndex = store.index('by-account-chain-timestamp')
        const cursor = await tsIndex.openCursor(
          IDBKeyRange.bound(
            [accountAddr, chainIdStr, 0],
            [accountAddr, chainIdStr, Number.MAX_SAFE_INTEGER]
          )
        )
        if (cursor) {
          console.log(
            `[ActivityIdbStorage] putSingleOp IDB cap hit (${count}/${MAX_IDB_GROUP_SIZE}) — evicting oldest op id=${cursor.value.id} ts=${cursor.value.timestamp} for ${accountAddr}:${chainIdStr}`
          )
          store.delete(cursor.primaryKey as IDBValidKey).catch(() => {})
        }
      }
    }

    await tx.done
    console.log(`[ActivityIdbStorage] putSingleOp committed for ${accountAddr}:${chainIdStr}`)
    this.checkQuota()
  }

  /**
   * Update existing rows in place (status or balance-change updates).
   * Uses store.put() per op — no range-delete, only touched rows are written.
   */
  async updateOps(ops: SubmittedAccountOp[]): Promise<void> {
    if (ops.length === 0) return
    await this.init()

    console.log(
      `[ActivityIdbStorage] updateOps ${ops.length} op(s): ${ops.map((o) => o.id).join(', ')}`
    )
    const tx = this.db!.transaction(this.config.storeName, 'readwrite')
    const store = tx.objectStore(this.config.storeName)
    for (const op of ops) {
      store.put(this.#opToRow(op.accountAddr, op.chainId.toString(), op)).catch(() => {})
    }
    await tx.done
    console.log(`[ActivityIdbStorage] updateOps committed`)
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
    await this.init()

    const chainIdStr = typeof chainId === 'bigint' ? chainId.toString() : chainId
    const range = IDBKeyRange.bound(
      [accountAddr, chainIdStr, ''],
      [accountAddr, chainIdStr, RANGE_HIGH]
    )
    const rows = (await this.db!.getAll(this.config.storeName, range)) as IdbAccountOpRow[]

    if (rows.length === 0) return undefined

    rows.sort((a, b) => b.timestamp - a.timestamp)
    const result = rows.map((r) => r.op as SubmittedAccountOp)
    console.log(
      `[ActivityIdbStorage] getOpsForAccountAndChain ${accountAddr}:${chainIdStr} - found ${result.length} ops`
    )
    return result
  }

  /**
   * Write ops for a single (account, chainId) pair.
   * Deletes existing rows for this pair first, then inserts new ones.
   */
  async putOpsForAccountAndChain(
    accountAddr: string,
    chainId: bigint | string,
    ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
  ): Promise<void> {
    return this.putMultiple([{ accountAddr, chainId, ops }])
  }

  /**
   * Batch write multiple (account, chainId) pairs in a single transaction.
   * More efficient than multiple individual puts.
   */
  async putMultiple(
    records: Array<{
      accountAddr: string
      chainId: bigint | string
      ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
    }>
  ): Promise<void> {
    await this.init()

    const tx = this.db!.transaction(this.config.storeName, 'readwrite')
    const store = tx.objectStore(this.config.storeName)

    for (const { accountAddr, chainId, ops } of records) {
      const chainIdStr = typeof chainId === 'bigint' ? chainId.toString() : chainId
      this.#writeRecordToStore(store, accountAddr, chainIdStr, this.#dedupeOpsById(ops))
    }

    await tx.done
    const totalOps = records.reduce((sum, r) => sum + r.ops.length, 0)
    console.log(
      `[ActivityIdbStorage] putMultiple complete - wrote ${records.length} records (${totalOps} ops)`
    )
    this.checkQuota()
  }

  /**
   * Delete all ops for an account across all chains.
   */
  async deleteAccount(accountAddr: string): Promise<void> {
    await this.init()

    const range = IDBKeyRange.bound([accountAddr, '', ''], [accountAddr, RANGE_HIGH, RANGE_HIGH])
    const tx = this.db!.transaction(this.config.storeName, 'readwrite')
    await tx.objectStore(this.config.storeName).delete(range)
    await tx.done
    console.log(`[ActivityIdbStorage] deleteAccount ${accountAddr} - deleted all rows`)
  }

  /**
   * One-time migration: import all ops from legacy blob storage into IDB.
   * After successful import, the caller should remove the key from legacy storage.
   */
  async migrateFromStorage(data: InternalAccountsOps): Promise<void> {
    const records = Object.entries(data).flatMap(([accountAddr, chainMap]) =>
      Object.entries(chainMap).map(([chainId, ops]) => ({ accountAddr, chainId, ops }))
    )
    const totalOps = records.reduce((sum, r) => sum + r.ops.length, 0)
    console.log(
      `[ActivityIdbStorage] migrateFromStorage - importing ${records.length} records with ${totalOps} total ops`
    )
    return this.putMultiple(records)
  }

  /**
   * Check if IDB has any data (used to detect if migration is needed).
   */
  async isEmpty(): Promise<boolean> {
    await this.init()

    const count = await this.db!.count(this.config.storeName)
    const empty = count === 0
    console.log(
      `[ActivityIdbStorage] isEmpty check - ${empty ? 'empty' : `${count} records found`}`
    )
    return empty
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

  #dedupeOpsById(
    ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
  ): (SubmittedAccountOp | SubmittedAccountOpLike)[] {
    const deduped = new Map<string, SubmittedAccountOp | SubmittedAccountOpLike>()

    for (const op of ops) {
      if (typeof op.id !== 'string' || !op.id) {
        console.warn('[ActivityIdbStorage] Skipping op without a valid id', op)
        continue
      }
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
