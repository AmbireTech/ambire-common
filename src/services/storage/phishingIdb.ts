import { IStorageController } from '../../interfaces/storage'
import { AmbireIdbDatabase } from './idbDatabase'

/** The update checkpoint. `version` selects a full fetch (0) or a delta fetch (> 0). */
export interface PhishingMeta {
  version: number
  updatedAt: number
}

/** One add/remove operation as the relayer sends it. */
export interface PhishingDelta {
  domains: { op: 'add' | 'remove'; value: string }[]
  addresses: { op: 'add' | 'remove'; value: string }[]
}

/** The whole list, used for a full refresh and by the key-value backend. */
export interface PhishingSnapshot extends PhishingMeta {
  domains: string[]
  addresses: string[]
}

export const DEFAULT_PHISHING_META: PhishingMeta = { version: 0, updatedAt: 0 }

export const DEFAULT_PHISHING_SNAPSHOT: PhishingSnapshot = {
  ...DEFAULT_PHISHING_META,
  domains: [],
  addresses: []
}

export interface IPhishingBackend {
  /** The checkpoint only — never the entries. */
  loadMeta(): Promise<PhishingMeta>

  hasDomain(domain: string): Promise<boolean>

  hasAddress(address: string): Promise<boolean>

  /** Replace both lists wholesale — the `version === 0` full-fetch path. */
  replaceAll(snapshot: PhishingSnapshot): Promise<void>

  /** Apply only what the server's delta named, plus the new checkpoint. */
  applyDelta(delta: PhishingDelta, meta: PhishingMeta): Promise<void>

  /** One-time move out of key-value storage. A no-op where that IS the final location. */
  ensureMigrated(
    getStoredData: () => Promise<PhishingSnapshot>,
    removeStoredData: () => Promise<void>
  ): Promise<void>
}

const META_ID = 'meta'

/**
 * Row-per-entry phishing storage.
 *
 * The relayer already speaks in add/remove deltas, so a write touches only the entries that
 * changed instead of rewriting the whole list. Rows and the version checkpoint are written in
 * ONE transaction: a crash between them would leave entries applied under a stale version, and
 * the next fetch would replay or skip a delta.
 */
export class PhishingIdbStorage implements IPhishingBackend {
  #db: AmbireIdbDatabase

  constructor(db: AmbireIdbDatabase) {
    this.#db = db
  }

  async loadMeta(): Promise<PhishingMeta> {
    const row = await this.#db.get('phishingMeta', META_ID)
    if (!row) return { ...DEFAULT_PHISHING_META }

    return { version: row.version, updatedAt: row.updatedAt }
  }

  async hasDomain(domain: string): Promise<boolean> {
    return (await this.#db.getKey('phishingDomains', domain)) !== undefined
  }

  async hasAddress(address: string): Promise<boolean> {
    return (await this.#db.getKey('phishingAddresses', address.toLowerCase())) !== undefined
  }

  async replaceAll(snapshot: PhishingSnapshot): Promise<void> {
    const tx = this.#db.transaction(
      ['phishingDomains', 'phishingAddresses', 'phishingMeta'],
      'readwrite'
    )
    const domainStore = tx.objectStore('phishingDomains')
    const addressStore = tx.objectStore('phishingAddresses')

    domainStore.clear().catch(() => {})
    addressStore.clear().catch(() => {})
    snapshot.domains.forEach((domain) => domainStore.put({ domain }).catch(() => {}))
    snapshot.addresses.forEach((address) =>
      addressStore.put({ address: address.toLowerCase() }).catch(() => {})
    )
    tx.objectStore('phishingMeta')
      .put({ id: META_ID, version: snapshot.version, updatedAt: snapshot.updatedAt })
      .catch(() => {})

    await tx.done
  }

  async applyDelta(delta: PhishingDelta, meta: PhishingMeta): Promise<void> {
    const tx = this.#db.transaction(
      ['phishingDomains', 'phishingAddresses', 'phishingMeta'],
      'readwrite'
    )
    const domainStore = tx.objectStore('phishingDomains')
    const addressStore = tx.objectStore('phishingAddresses')

    delta.domains.forEach(({ op, value }) => {
      if (op === 'add') domainStore.put({ domain: value }).catch(() => {})
      else domainStore.delete(value).catch(() => {})
    })
    delta.addresses.forEach(({ op, value }) => {
      const address = value.toLowerCase()
      if (op === 'add') addressStore.put({ address }).catch(() => {})
      else addressStore.delete(address).catch(() => {})
    })
    tx.objectStore('phishingMeta')
      .put({ id: META_ID, version: meta.version, updatedAt: meta.updatedAt })
      .catch(() => {})

    await tx.done
  }

  /** Empty means never migrated: the meta row is written by every write path. */
  async isEmpty(): Promise<boolean> {
    return (await this.#db.count('phishingMeta')) === 0
  }

  async ensureMigrated(
    getStoredData: () => Promise<PhishingSnapshot>,
    removeStoredData: () => Promise<void>
  ): Promise<void> {
    if (!(await this.isEmpty())) return

    const legacy = await getStoredData()
    // A blank payload would write a meta row and make isEmpty() skip a later real migration.
    if (!legacy.domains.length && !legacy.addresses.length && !legacy.version) return

    await this.replaceAll(legacy)
    // Only after the write lands, so a failed removal still leaves the data migrated.
    await removeStoredData()
  }
}

/**
 * chrome.storage.local phishing storage, for environments without IndexedDB (mobile).
 *
 * The blob is the final location here, so there is nothing to migrate and no row-level
 * granularity to offer — every write serializes the whole list, and reads come from memory.
 */
export class PhishingKeyValueStorage implements IPhishingBackend {
  #storage: IStorageController

  /**
   * The blob, held after the first read.
   *
   * Without it every lookup would deserialize the whole list from storage, and the batch
   * status checks call one lookup per dApp — so a single check would re-read it N times.
   * Kept in step by the writes below rather than invalidated, since they already know the
   * resulting state.
   */
  #cached: PhishingSnapshot | null = null

  constructor(storage: IStorageController) {
    this.#storage = storage
  }

  async #read(): Promise<PhishingSnapshot> {
    if (!this.#cached) {
      this.#cached = (await this.#storage.get('phishing', {
        ...DEFAULT_PHISHING_SNAPSHOT
      })) as PhishingSnapshot
    }

    return this.#cached
  }

  async loadMeta(): Promise<PhishingMeta> {
    const { version, updatedAt } = await this.#read()

    return { version, updatedAt }
  }

  async hasDomain(domain: string): Promise<boolean> {
    return (await this.#read()).domains.includes(domain)
  }

  async hasAddress(address: string): Promise<boolean> {
    return (await this.#read()).addresses.includes(address.toLowerCase())
  }

  async replaceAll(snapshot: PhishingSnapshot): Promise<void> {
    const next = {
      ...snapshot,
      addresses: snapshot.addresses.map((address) => address.toLowerCase())
    }

    await this.#storage.set('phishing', next)
    this.#cached = next
  }

  async applyDelta(delta: PhishingDelta, meta: PhishingMeta): Promise<void> {
    const current = await this.#read()
    const domains = new Set(current.domains)
    const addresses = new Set(current.addresses)

    delta.domains.forEach(({ op, value }) =>
      op === 'add' ? domains.add(value) : domains.delete(value)
    )
    delta.addresses.forEach(({ op, value }) => {
      const address = value.toLowerCase()
      if (op === 'add') addresses.add(address)
      else addresses.delete(address)
    })

    const next = { ...meta, domains: [...domains], addresses: [...addresses] }

    await this.#storage.set('phishing', next)
    this.#cached = next
  }

  // Nothing to migrate — this backend already holds the data in its final location.
  async ensureMigrated(
    _getStoredData: () => Promise<PhishingSnapshot>,
    _removeStoredData: () => Promise<void>
  ): Promise<void> {}
}
