import { IDBPDatabase, openDB } from 'idb'

export interface IdbIndexDef {
  name: string
  keyPath: string | string[]
}

/**
 * Configuration for an IndexedDB store.
 */
export interface IdbStoreConfig {
  dbName: string
  storeName: string
  keyPath: string | string[]
  dbVersion?: number
  indexes?: IdbIndexDef[]
}

interface DbRegistry {
  stores: Map<string, IdbStoreConfig>
  db: IDBPDatabase<any> | null
  openPromise: Promise<IDBPDatabase<any>> | null
  version: number
}

/**
 * Base IndexedDB storage service.
 *
 * Maintains a static registry of all stores per database name so that a single
 * database connection is shared across all stores. The one onupgradeneeded
 * handler creates every registered store, preventing version conflicts when
 * multiple stores share the same database.
 *
 * Subclasses pass their full config (including indexes) to super() — that is
 * enough to participate in the shared connection. No doInit override needed.
 */
export class BaseIdbStore {
  private static readonly registries = new Map<string, DbRegistry>()

  protected db: IDBPDatabase<any> | null = null
  protected initPromise: Promise<void> | null = null
  protected config: IdbStoreConfig

  constructor(config: IdbStoreConfig) {
    this.config = { dbVersion: 1, ...config }
    BaseIdbStore.#registerStore(this.config)
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Static registry helpers
  // ──────────────────────────────────────────────────────────────────────────────

  static #registerStore(config: IdbStoreConfig): void {
    const { dbName, dbVersion = 1 } = config

    if (!BaseIdbStore.registries.has(dbName)) {
      BaseIdbStore.registries.set(dbName, {
        stores: new Map(),
        db: null,
        openPromise: null,
        version: dbVersion
      })
    }

    const registry = BaseIdbStore.registries.get(dbName)!

    if (registry.db || registry.openPromise) {
      // The DB is already open — a store was constructed after the first init() call.
      // Its schema will not be applied until the next version bump.
      console.error(
        `[BaseIdbStore] Store "${config.storeName}" registered after "${dbName}" is already open — schema will not be applied until the next version bump.`
      )
    }

    registry.stores.set(config.storeName, config)
    registry.version = Math.max(registry.version, dbVersion)
  }

  static #getDb(
    dbName: string,
    version: number,
    stores: Map<string, IdbStoreConfig>
  ): Promise<IDBPDatabase<any>> {
    const registry = BaseIdbStore.registries.get(dbName)!

    if (registry.db) return Promise.resolve(registry.db)
    if (registry.openPromise) return registry.openPromise

    registry.openPromise = openDB(dbName, version, {
      upgrade(db, oldVersion) {
        console.log(`[BaseIdbStore] Upgrading "${dbName}" from v${oldVersion} → v${version}`)
        for (const storeDef of stores.values()) {
          if (!db.objectStoreNames.contains(storeDef.storeName)) {
            const store = db.createObjectStore(storeDef.storeName, {
              keyPath: storeDef.keyPath
            })
            for (const idx of storeDef.indexes ?? []) {
              store.createIndex(idx.name, idx.keyPath)
            }
            console.log(`[BaseIdbStore] Created store "${storeDef.storeName}"`)
          }
          // When oldVersion > 0 and the store already exists, add migration branches here.
        }
      }
    })
      .then((db) => {
        registry.db = db
        console.log(`[BaseIdbStore] Opened "${dbName}" v${version}`)
        return db
      })
      .catch((error) => {
        // Allow a subsequent openDB attempt after a transient failure.
        registry.openPromise = null
        throw error
      })

    return registry.openPromise
  }

  /**
   * Reset the shared connection for a database — for use in tests only.
   * Call in beforeEach after replacing global.indexedDB with a fresh IDBFactory.
   */
  static resetDb(dbName: string): void {
    const registry = BaseIdbStore.registries.get(dbName)
    if (!registry) return
    registry.db?.close()
    registry.db = null
    registry.openPromise = null
    registry.stores.clear()
    BaseIdbStore.registries.delete(dbName)
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Instance methods
  // ──────────────────────────────────────────────────────────────────────────────

  protected async init(): Promise<void> {
    if (this.db) return
    if (this.initPromise) return this.initPromise

    console.log(
      `[BaseIdbStore] init() starting for "${this.config.dbName}/${this.config.storeName}"`
    )
    this.initPromise = this.doInit().catch((error) => {
      // Allow a subsequent init() call to retry after a transient failure.
      console.error(
        `[BaseIdbStore] init() failed for "${this.config.dbName}/${this.config.storeName}", will retry on next call`,
        error
      )
      this.initPromise = null
      throw error
    })
    await this.initPromise
    console.log(`[BaseIdbStore] init() ready for "${this.config.dbName}/${this.config.storeName}"`)
  }

  protected async doInit(): Promise<void> {
    const registry = BaseIdbStore.registries.get(this.config.dbName)!
    this.db = await BaseIdbStore.#getDb(this.config.dbName, registry.version, registry.stores)
  }

  protected async getAll<T>(): Promise<T[]> {
    await this.init()
    return this.db!.getAll(this.config.storeName) as Promise<T[]>
  }

  protected async put(record: unknown): Promise<void> {
    await this.init()
    await this.db!.put(this.config.storeName, record)
  }

  protected async putMultiple(records: unknown[]): Promise<void> {
    await this.init()
    const tx = this.db!.transaction(this.config.storeName, 'readwrite')
    await Promise.all(records.map((r) => tx.objectStore(this.config.storeName).put(r)))
    await tx.done
  }

  protected async delete(key: IDBValidKey | IDBKeyRange): Promise<void> {
    await this.init()
    await this.db!.delete(this.config.storeName, key as any)
  }

  protected async clear(): Promise<void> {
    await this.init()
    await this.db!.clear(this.config.storeName)
  }

  protected async isEmpty(): Promise<boolean> {
    await this.init()
    return (await this.db!.count(this.config.storeName)) === 0
  }

  protected checkQuota(): void {
    if (!navigator.storage?.estimate) return

    navigator.storage
      .estimate()
      .then((estimate) => {
        if (!estimate.quota || !estimate.usage) return

        const percentUsed = (estimate.usage / estimate.quota) * 100
        const usedMB = (estimate.usage / 1024 / 1024).toFixed(1)
        const quotaMB = (estimate.quota / 1024 / 1024).toFixed(1)

        console.log(
          `[BaseIdbStore] ${this.config.storeName} quota: ${usedMB}MB / ${quotaMB}MB (${percentUsed.toFixed(1)}%)`
        )

        if (percentUsed > 80) {
          console.warn(
            `[BaseIdbStore] ${this.config.storeName} quota usage high (${percentUsed.toFixed(1)}%)`
          )
        }
      })
      .catch(() => {})
  }
}
