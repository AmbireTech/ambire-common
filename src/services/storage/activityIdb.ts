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

interface IdbAccountOpRow {
  accountAddr: string
  chainId: string // bigint converted to string for IDB compatibility
  id: string // op.id
  timestamp: number
  status: AccountOpStatus
  serializedOp: string // JSON.stringify with bigint→string replacement
}

// The highest BMP Unicode character — used as a range upper bound to select all keys
// that start with a given prefix, without matching the prefix itself as a key.
const RANGE_HIGH = '\uffff'

export class ActivityIdbStorage extends BaseIdbStore implements IActivityIdbStorage {
  constructor() {
    super({
      dbName: 'ambire',
      storeName: 'accountsOps',
      keyPath: ['accountAddr', 'chainId', 'id'],
      dbVersion: 1
    })
  }

  /**
   * Override doInit to create the object store with the compound keyPath.
   * Any existing store from an older schema version is dropped — no data migration.
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

        db.createObjectStore(this.config.storeName, { keyPath: this.config.keyPath })
        console.log(`[BaseIdbStore] Created store "${this.config.storeName}"`)
      }
    })
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * Load minimal startup dataset: all pending ops + up to STARTUP_RECENT_OPS_LIMIT
   * finalized ops per (account, chain). Reads all rows then filters in JS.
   */
  async loadStartupOps(): Promise<InternalAccountsOps> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readonly')
      const request = tx.objectStore(this.config.storeName).getAll()

      request.onerror = () => {
        console.error('[ActivityIdbStorage] loadStartupOps error', request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        const rows = (request.result as IdbAccountOpRow[]).sort(
          (a, b) => b.timestamp - a.timestamp
        )

        const result: InternalAccountsOps = {}
        const finalizedCount = new Map<string, number>()

        for (const row of rows) {
          const isPending =
            row.status === AccountOpStatus.BroadcastedButNotConfirmed ||
            row.status === AccountOpStatus.Pending
          const groupKey = `${row.accountAddr}:${row.chainId}`
          const count = finalizedCount.get(groupKey) ?? 0

          if (!isPending && count >= STARTUP_RECENT_OPS_LIMIT) continue

          if (!result[row.accountAddr]) result[row.accountAddr] = {}
          const chainMap = result[row.accountAddr]!
          if (!chainMap[row.chainId]) chainMap[row.chainId] = []
          chainMap[row.chainId]!.push(deserializeOp(row.serializedOp))

          if (!isPending) finalizedCount.set(groupKey, count + 1)
        }

        console.log(`[ActivityIdbStorage] loadStartupOps: loaded from ${rows.length} rows`)
        resolve(result)
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
        this.#writeRecordToStore(store, accountAddr, chainIdStr, this.#dedupeOpsById(ops))
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
    store.delete(
      IDBKeyRange.bound([accountAddr, chainIdStr, ''], [accountAddr, chainIdStr, RANGE_HIGH])
    )
    for (const op of ops) {
      store.put(this.#opToRow(accountAddr, chainIdStr, op))
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
      serializedOp: serializeOp(op)
    }
  }
}
