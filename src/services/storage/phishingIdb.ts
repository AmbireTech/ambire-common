import { IStorageController as IStorageControllerType } from '../../interfaces/storage'
import { AmbireIdbDatabase } from './idbDatabase'

export interface PhishingSnapshot {
  version: number
  updatedAt: number
  domains: string[]
  addresses: string[]
}

export const DEFAULT_PHISHING_SNAPSHOT: PhishingSnapshot = {
  version: 0,
  updatedAt: 0,
  domains: [],
  addresses: []
}

/**
 * Persistence backend for the phishing list snapshot.
 * Implementations: PhishingIdbStorage (IndexedDB) and PhishingKeyValueStorage (chrome.storage.local).
 * PhishingController always holds one of these — there are no conditional IDB checks in the controller.
 */
export interface IPhishingOpsBackend {
  /**
   * Returns true if the store has no phishing snapshot yet.
   * Used by ensureMigrated to decide whether migration is needed.
   */
  isEmpty(): Promise<boolean>

  /**
   * Load the persisted phishing snapshot.
   * Returns DEFAULT_PHISHING_SNAPSHOT if no data has been saved yet.
   */
  loadSnapshot(): Promise<PhishingSnapshot>

  /**
   * Persist the full phishing snapshot (version + updatedAt + domains + addresses).
   */
  saveSnapshot(data: PhishingSnapshot): Promise<void>

  /**
   * One-time migration from legacy chrome.storage.local to IDB.
   * IDB backend: migrates if empty; key-value backend: no-op.
   */
  ensureMigrated(
    getStoredData: () => Promise<PhishingSnapshot>,
    removeStoredData: () => Promise<void>
  ): Promise<void>

  /**
   * Import a snapshot from the legacy storage format.
   * Called by ensureMigrated; also exposed for tests.
   */
  migrateFromStorage(data: PhishingSnapshot): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// IDB backend
// ─────────────────────────────────────────────────────────────────────────────

// The 'phishing' store holds a single document keyed by this constant.
// All reads and writes target this one record.
//
// NOTE: deliberately NOT in AMBIRE_IDB_SCHEMA. Adding it needs a dbVersion bump, and a
// shipped bump cannot be rolled back — not worth carrying for a store nothing reads. Add it
// in the same change that wires PhishingController.
const STORE_NAME = 'phishing'
const SNAPSHOT_KEY = 'snapshot'

interface PhishingIdbRow extends PhishingSnapshot {
  id: string // always SNAPSHOT_KEY
}

export class PhishingIdbStorage implements IPhishingOpsBackend {
  #db: AmbireIdbDatabase
  #storeName = STORE_NAME

  constructor(db: AmbireIdbDatabase) {
    this.#db = db
  }

  async isEmpty(): Promise<boolean> {
    const count = await this.#db.count(this.#storeName)
    return count === 0
  }

  async loadSnapshot(): Promise<PhishingSnapshot> {
    const row = (await this.#db.get(this.#storeName, SNAPSHOT_KEY)) as PhishingIdbRow | undefined
    if (!row) return { ...DEFAULT_PHISHING_SNAPSHOT }
    const { id: _id, ...snapshot } = row
    return snapshot
  }

  async saveSnapshot(data: PhishingSnapshot): Promise<void> {
    await this.#db.put(this.#storeName, { id: SNAPSHOT_KEY, ...data })
  }

  async migrateFromStorage(data: PhishingSnapshot): Promise<void> {
    await this.saveSnapshot(data)
  }

  async ensureMigrated(
    getStoredData: () => Promise<PhishingSnapshot>,
    removeStoredData: () => Promise<void>
  ): Promise<void> {
    const empty = await this.isEmpty()
    if (!empty) return

    const stored = await getStoredData()
    // Skip migration if storage also has no meaningful data. updatedAt is
    // deliberately excluded: a timestamp with no domains or addresses does not
    // represent meaningful phishing data.
    if (!stored.version && !stored.domains.length && !stored.addresses.length) return

    await this.migrateFromStorage(stored)
    await removeStoredData()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Key-value storage backend (mobile / IDB-unavailable fallback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * chrome.storage.local–backed persistence for the phishing snapshot.
 * Used in environments without IndexedDB support (mobile).
 * Reads and writes the full snapshot blob directly — no IDB involved.
 */
export class PhishingKeyValueStorage implements IPhishingOpsBackend {
  #storage: IStorageControllerType

  constructor(storage: IStorageControllerType) {
    this.#storage = storage
  }

  // Data is already in storage — isEmpty is meaningless for this backend.
  async isEmpty(): Promise<boolean> {
    return false
  }

  async loadSnapshot(): Promise<PhishingSnapshot> {
    return this.#storage.get('phishing', { ...DEFAULT_PHISHING_SNAPSHOT })
  }

  async saveSnapshot(data: PhishingSnapshot): Promise<void> {
    await this.#storage.set('phishing', data)
  }

  // Migration is not needed — data is already in the right place.
  async migrateFromStorage(_data: PhishingSnapshot): Promise<void> {}

  async ensureMigrated(
    _getStoredData: () => Promise<PhishingSnapshot>,
    _removeStoredData: () => Promise<void>
  ): Promise<void> {}
}
