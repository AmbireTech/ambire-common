import { IStorageController as IStorageControllerType } from '../../interfaces/storage'
import { AmbireIdbDatabase } from './idbDatabase'
import { IdbPhishingRow } from './idbSchema'

/** The stored row minus its key — derived so the field list is not duplicated. */
export type PhishingSnapshot = Omit<IdbPhishingRow, 'id'>

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
}

// isEmpty()/migrateFromStorage() stay off the interface — declaring them would force dead
// stubs onto the key-value class.

// ─────────────────────────────────────────────────────────────────────────────
// IDB backend
// ─────────────────────────────────────────────────────────────────────────────

// The store holds a single document under this key. In AMBIRE_IDB_SCHEMA at dbVersion 1 —
// no bump was needed because v1 had not shipped when it was added.
const SNAPSHOT_KEY = 'snapshot'

export class PhishingIdbStorage implements IPhishingOpsBackend {
  #db: AmbireIdbDatabase
  // Literal so idb can resolve the row type for this store; see AmbireIdbSchema.
  #storeName = 'phishing' as const

  constructor(db: AmbireIdbDatabase) {
    this.#db = db
  }

  async isEmpty(): Promise<boolean> {
    const count = await this.#db.count(this.#storeName)
    return count === 0
  }

  async loadSnapshot(): Promise<PhishingSnapshot> {
    const row = await this.#db.get(this.#storeName, SNAPSHOT_KEY)
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

  async loadSnapshot(): Promise<PhishingSnapshot> {
    return this.#storage.get('phishing', { ...DEFAULT_PHISHING_SNAPSHOT })
  }

  async saveSnapshot(data: PhishingSnapshot): Promise<void> {
    await this.#storage.set('phishing', data)
  }

  async ensureMigrated(
    _getStoredData: () => Promise<PhishingSnapshot>,
    _removeStoredData: () => Promise<void>
  ): Promise<void> {}
}
