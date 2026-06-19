import { IActivityIdbStorage, InternalAccountsOps } from '../../interfaces/activity'
import { SubmittedAccountOp, SubmittedAccountOpLike } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { BaseIdbStore } from './baseIdbStore'

const STARTUP_RECENT_OPS_LIMIT = 20

// Known bigint field names — used by the JSON reviver to restore bigint values after deserialization
const BIGINT_FIELDS = new Set([
  'chainId',
  'nonce',
  'eoaNonce',
  'amount',
  'amountBefore',
  'amountAfter',
  'balanceChange',
  'feeTokenChainId',
  'simulatedGasLimit',
  'gasPrice',
  'maxPriorityFeePerGas'
])

function serializeOp(op: SubmittedAccountOp | SubmittedAccountOpLike): string {
  return JSON.stringify(op, (_key, value) => {
    if (typeof value === 'bigint') return value.toString()
    return value
  })
}

function deserializeOp(serialized: string): SubmittedAccountOp {
  return JSON.parse(serialized, (key, value) => {
    if (!BIGINT_FIELDS.has(key) || typeof value !== 'string') return value
    try {
      return BigInt(value)
    } catch {
      return value
    }
  }) as SubmittedAccountOp
}

/**
 * One IDB row per submitted account op (v2 schema).
 * keyPath: ['accountAddr', 'chainId', 'id']
 * index 'by-account-chain-timestamp': ['accountAddr', 'chainId', 'timestamp']
 */
interface IdbAccountOpRow {
  accountAddr: string
  chainId: string // bigint converted to string for IDB compatibility
  id: string // op.id
  timestamp: number
  status: AccountOpStatus
  serializedOp: string // JSON.stringify with bigint→string replacement
}

// The highest unicode character — used as a range upper bound to select all keys
// that start with a given prefix, without matching the prefix itself as a key.
const RANGE_HIGH = '￿'

/**
 * IndexedDB-backed storage for account operations — v2 row-per-op schema.
 *
 * One IDB record per SubmittedAccountOp, indexed by timestamp so that
 * loadStartupOps() can use a cursor to fetch only the needed subset instead of
 * reading the full history for every (account, chain).
 *
 * Extends BaseIdbStore for common IDB operations and error handling.
 */
export class ActivityIdbStorage extends BaseIdbStore implements IActivityIdbStorage {
  constructor() {
    super({
      dbName: 'ambire-activity',
      storeName: 'accountsOps',
      keyPath: ['accountAddr', 'chainId', 'id'],
      dbVersion: 3
    })
  }

  /**
   * Override doInit to create the object store with the compound keyPath and
   * the 'by-account-chain-timestamp' index. Any existing store from an older
   * schema version is dropped — no data migration.
   */
  protected doInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.dbVersion)

      request.onerror = () => {
        console.error(`BaseIdbStore: Failed to open ${this.config.dbName}`, request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        this.db = request.result
        console.log(
          `[BaseIdbStore] Opened ${this.config.dbName} v${this.config.dbVersion} with store "${this.config.storeName}"`
        )
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        if (db.objectStoreNames.contains(this.config.storeName)) {
          db.deleteObjectStore(this.config.storeName)
        }

        const store = db.createObjectStore(this.config.storeName, {
          keyPath: this.config.keyPath
        })
        store.createIndex('by-account-chain-timestamp', ['accountAddr', 'chainId', 'timestamp'])
        console.log(`[BaseIdbStore] Created store "${this.config.storeName}"`)
      }
    })
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * Load minimal startup dataset using a cursor on 'by-account-chain-timestamp'
   * (newest-first). For each (account, chain) group we collect:
   *   - All pending ops (BroadcastedButNotConfirmed | Pending)
   *   - Up to STARTUP_RECENT_OPS_LIMIT finalized ops
   * Once a group has enough finalized ops the cursor jumps to the next chain.
   */
  async loadStartupOps(): Promise<InternalAccountsOps> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readonly')
      const store = tx.objectStore(this.config.storeName)
      const index = store.index('by-account-chain-timestamp')

      // 'prev' gives us newest first within each (accountAddr, chainId) group
      const cursorRequest = index.openCursor(null, 'prev')

      const result: InternalAccountsOps = {}
      // Tracks how many finalized ops we've collected per group key
      const finalizedCount = new Map<string, number>()
      // Accumulates rows before we sort and deserialize at the end
      const rowsByGroup = new Map<string, IdbAccountOpRow[]>()

      let totalRecords = 0

      cursorRequest.onerror = () => {
        console.error('[ActivityIdbStorage] loadStartupOps cursor error', cursorRequest.error)
        reject(cursorRequest.error)
      }

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result as IDBCursorWithValue | null

        if (!cursor) {
          // Cursor exhausted — build the result object
          let totalOps = 0
          for (const [groupKey, rows] of rowsByGroup) {
            // Sort descending by timestamp (cursor already delivered newest-first
            // within a chain, but groups may interleave so re-sort to be safe)
            rows.sort((a, b) => b.timestamp - a.timestamp)
            const [accountAddr, chainIdStr] = groupKey.split(':')
            if (!result[accountAddr]) result[accountAddr] = {}
            result[accountAddr][chainIdStr] = rows.map((r) => deserializeOp(r.serializedOp))
            totalOps += rows.length
          }
          console.log(
            `[ActivityIdbStorage] loadStartupOps complete: ${totalRecords} records, ${totalOps} ops loaded`
          )
          resolve(result)
          return
        }

        const row = cursor.value as IdbAccountOpRow
        totalRecords++

        const groupKey = `${row.accountAddr}:${row.chainId}`
        const isPending =
          row.status === AccountOpStatus.BroadcastedButNotConfirmed ||
          row.status === AccountOpStatus.Pending

        if (isPending) {
          // Always include pending ops — just collect and advance
          if (!rowsByGroup.has(groupKey)) rowsByGroup.set(groupKey, [])
          rowsByGroup.get(groupKey)!.push(row)
          cursor.continue()
          return
        }

        // Finalized op
        const count = finalizedCount.get(groupKey) ?? 0
        if (count < STARTUP_RECENT_OPS_LIMIT) {
          if (!rowsByGroup.has(groupKey)) rowsByGroup.set(groupKey, [])
          rowsByGroup.get(groupKey)!.push(row)
          finalizedCount.set(groupKey, count + 1)
        }
        // Always advance without a key argument — cursor.continue(key) in 'prev'
        // direction requires the key to be strictly less than the current position,
        // so the chainId + RANGE_HIGH skip trick only works in 'next' direction.
        // Saturated groups are skipped in JS above; we still iterate their rows.
        cursor.continue()
      }
    })
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

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readonly')
      const store = tx.objectStore(this.config.storeName)

      // Bound on [accountAddr, chainIdStr, ''] → [accountAddr, chainIdStr, RANGE_HIGH]
      const range = IDBKeyRange.bound(
        [accountAddr, chainIdStr, ''],
        [accountAddr, chainIdStr, RANGE_HIGH]
      )
      const request = store.getAll(range)

      request.onerror = () => {
        console.error(
          `ActivityIdbStorage: Failed to get ops for ${accountAddr}:${chainIdStr}`,
          request.error
        )
        reject(request.error)
      }

      request.onsuccess = () => {
        const rows = (request.result || []) as IdbAccountOpRow[]
        if (rows.length === 0) {
          resolve(undefined)
          return
        }
        // Sort descending by timestamp
        rows.sort((a, b) => b.timestamp - a.timestamp)
        const ops = rows.map((r) => deserializeOp(r.serializedOp))
        console.log(
          `[ActivityIdbStorage] getOpsForAccountAndChain ${accountAddr}:${chainIdStr} - found ${ops.length} ops`
        )
        resolve(ops)
      }
    })
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

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readwrite')
      const store = tx.objectStore(this.config.storeName)

      for (const { accountAddr, chainId, ops } of records) {
        const chainIdStr = typeof chainId === 'bigint' ? chainId.toString() : chainId
        this.#writeRecordToStore(store, accountAddr, chainIdStr, ops)
      }

      tx.onerror = () => {
        console.error('ActivityIdbStorage: Batch put failed', tx.error)
        reject(tx.error)
      }

      tx.oncomplete = () => {
        const totalOps = records.reduce((sum, r) => sum + r.ops.length, 0)
        console.log(
          `[ActivityIdbStorage] putMultiple complete - wrote ${records.length} records (${totalOps} ops)`
        )
        this.checkQuota()
        resolve()
      }
    })
  }

  /**
   * Delete all ops for an account across all chains.
   */
  async deleteAccount(accountAddr: string): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readwrite')
      const store = tx.objectStore(this.config.storeName)

      // IDB compound key range: all keys where first component === accountAddr
      const range = IDBKeyRange.bound([accountAddr, '', ''], [accountAddr, RANGE_HIGH, RANGE_HIGH])
      const request = store.delete(range)

      request.onerror = () => {
        console.error(
          `ActivityIdbStorage: Failed to delete account ${accountAddr}`,
          request.error
        )
        reject(request.error)
      }

      tx.oncomplete = () => {
        console.log(`[ActivityIdbStorage] deleteAccount ${accountAddr} - deleted all rows`)
        resolve()
      }

      tx.onerror = () => {
        console.error(
          `ActivityIdbStorage: Failed to delete account ${accountAddr} during transaction`,
          tx.error
        )
        reject(tx.error)
      }
    })
  }

  /**
   * One-time migration: import all ops from chrome.storage.local into IDB.
   * After successful import, the caller should remove the key from chrome.storage.local.
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

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readonly')
      const store = tx.objectStore(this.config.storeName)
      const request = store.count()

      request.onerror = () => {
        console.error('ActivityIdbStorage: Failed to check if empty', request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        const empty = request.result === 0
        console.log(
          `[ActivityIdbStorage] isEmpty check - ${empty ? 'empty' : `${request.result} records found`}`
        )
        resolve(empty)
      }
    })
  }

  /**
   * Debug: dump all data in the database without trimming (for testing only).
   */
  async debugDumpAll(): Promise<InternalAccountsOps> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readonly')
      const store = tx.objectStore(this.config.storeName)
      const request = store.getAll()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const rows = (request.result || []) as IdbAccountOpRow[]
        const result: InternalAccountsOps = {}

        for (const row of rows) {
          if (!result[row.accountAddr]) result[row.accountAddr] = {}
          if (!result[row.accountAddr][row.chainId]) result[row.accountAddr][row.chainId] = []
          result[row.accountAddr][row.chainId].push(deserializeOp(row.serializedOp))
        }

        // Sort each group descending by timestamp
        for (const chainMap of Object.values(result)) {
          for (const ops of Object.values(chainMap)) {
            ops.sort((a, b) => b.timestamp - a.timestamp)
          }
        }

        for (const [accountAddr, chainMap] of Object.entries(result)) {
          for (const [chainId, ops] of Object.entries(chainMap)) {
            console.log(`[ActivityIdbStorage] DEBUG: ${accountAddr}:${chainId} = ${ops.length} ops`)
          }
        }

        console.log(`[ActivityIdbStorage] DEBUG dump complete: ${rows.length} rows`)
        resolve(result)
      }
    })
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────────

  #writeRecordToStore(
    store: IDBObjectStore,
    accountAddr: string,
    chainIdStr: string,
    ops: (SubmittedAccountOp | SubmittedAccountOpLike)[]
  ): void {
    // Delete existing rows for this (account, chain), then insert fresh ones
    store.delete(IDBKeyRange.bound([accountAddr, chainIdStr, ''], [accountAddr, chainIdStr, RANGE_HIGH]))
    for (const op of ops) {
      store.put(this.#opToRow(accountAddr, chainIdStr, op))
    }
  }

  #opToRow(
    accountAddr: string,
    chainIdStr: string,
    op: SubmittedAccountOp | SubmittedAccountOpLike
  ): IdbAccountOpRow {
    return {
      accountAddr,
      chainId: chainIdStr,
      id: (op as any).id as string,
      timestamp: (op as any).timestamp as number,
      status: (op as any).status as AccountOpStatus,
      serializedOp: serializeOp(op)
    }
  }
}
