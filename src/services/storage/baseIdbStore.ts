/**
 * Configuration for an IndexedDB store.
 */
export interface IdbStoreConfig {
  dbName: string
  storeName: string
  keyPath: string | string[]
  dbVersion?: number
}

/**
 * Base IndexedDB storage service.
 * Handles common operations: open/upgrade, transactions, error handling.
 * Extend this for specific data types.
 */
export class BaseIdbStore {
  protected db: IDBDatabase | null = null
  protected initPromise: Promise<void> | null = null
  protected config: IdbStoreConfig

  constructor(config: IdbStoreConfig) {
    this.config = {
      dbVersion: 1,
      ...config
    }
  }

  protected async init(): Promise<void> {
    if (this.db) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this.doInit()
    await this.initPromise
  }

  protected async doInit(): Promise<void> {
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
        if (!db.objectStoreNames.contains(this.config.storeName)) {
          db.createObjectStore(this.config.storeName, { keyPath: this.config.keyPath })
          console.log(`[BaseIdbStore] Created store "${this.config.storeName}"`)
        }
      }
    })
  }

  protected async getAll<T>(): Promise<T[]> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readonly')
      const store = tx.objectStore(this.config.storeName)
      const request = store.getAll()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result as T[])
    })
  }

  protected async put(record: any): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readwrite')
      const store = tx.objectStore(this.config.storeName)
      store.put(record)

      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => resolve()
    })
  }

  protected async putMultiple(records: any[]): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readwrite')
      const store = tx.objectStore(this.config.storeName)

      records.forEach((record) => store.put(record))

      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => resolve()
    })
  }

  protected async delete(key: any): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readwrite')
      const store = tx.objectStore(this.config.storeName)
      const request = store.delete(key)

      request.onerror = () => reject(request.error)
      tx.oncomplete = () => resolve()
    })
  }

  protected async clear(): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readwrite')
      const store = tx.objectStore(this.config.storeName)
      const request = store.clear()

      request.onerror = () => reject(request.error)
      tx.oncomplete = () => resolve()
    })
  }

  protected async isEmpty(): Promise<boolean> {
    await this.init()

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.config.storeName], 'readonly')
      const store = tx.objectStore(this.config.storeName)
      const request = store.count()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result === 0)
    })
  }

  protected checkQuota(): void {
    if (!navigator.storage?.estimate) return

    navigator.storage.estimate().then((estimate) => {
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
  }
}
