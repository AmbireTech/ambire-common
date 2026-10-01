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
/**
 * How many buckets each list is spread over.
 *
 * Part of the stored format, not a tuning knob: change it, or the hash below, and every stored
 * entry lands in a bucket lookups no longer read, so the whole list has to be rewritten.
 *
 * At ~450k domains this is ~440 entries per bucket — small enough that a lookup deserializes
 * almost nothing, large enough that a full write is ~1k rows instead of 450k.
 */
export const PHISHING_BUCKET_COUNT = 1024

/**
 * Which bucket an entry belongs to. Deliberately trivial: it runs once per lookup and 450k
 * times per full write, and it needs to be stable across releases, not well-distributed
 * against an adversary.
 */
export function phishingBucketOf(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }

  return Math.abs(hash) % PHISHING_BUCKET_COUNT
}

/**
 * Spreads a whole list across the buckets. Empty buckets are dropped rather than stored as
 * empty rows — a lookup treats a missing bucket and an empty one the same way.
 */
function groupIntoBuckets(values: string[]): Map<number, string[]> {
  const buckets = new Map<number, string[]>()
  values.forEach((value) => {
    const id = phishingBucketOf(value)
    const existing = buckets.get(id)
    if (existing) existing.push(value)
    else buckets.set(id, [value])
  })

  return buckets
}

type PhishingListStore = 'phishingDomains' | 'phishingAddresses'

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
    return this.#has('phishingDomains', domain)
  }

  async hasAddress(address: string): Promise<boolean> {
    return this.#has('phishingAddresses', address.toLowerCase())
  }

  /** One read of one bucket — the hash says which, so nothing is scanned. */
  async #has(storeName: PhishingListStore, value: string): Promise<boolean> {
    const bucket = await this.#db.get(storeName, phishingBucketOf(value))

    return !!bucket?.entries.includes(value)
  }

  async replaceAll(snapshot: PhishingSnapshot): Promise<void> {
    // Grouped before the transaction opens: an IDB transaction closes as soon as its request
    // queue drains, and this is pure CPU work with no requests in flight.
    const domainBuckets = groupIntoBuckets(snapshot.domains)
    const addressBuckets = groupIntoBuckets(
      snapshot.addresses.map((address) => address.toLowerCase())
    )

    const tx = this.#db.transaction(
      ['phishingDomains', 'phishingAddresses', 'phishingMeta'],
      'readwrite'
    )
    const domainStore = tx.objectStore('phishingDomains')
    const addressStore = tx.objectStore('phishingAddresses')

    domainStore.clear().catch(() => {})
    addressStore.clear().catch(() => {})
    domainBuckets.forEach((entries, id) => domainStore.put({ id, entries }).catch(() => {}))
    addressBuckets.forEach((entries, id) => addressStore.put({ id, entries }).catch(() => {}))

    // Last, so a transaction that fails leaves the checkpoint behind and the next fetch
    // replays rather than skipping what never landed.
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

    await this.#applyDeltaToStore(tx.objectStore('phishingDomains'), delta.domains)
    await this.#applyDeltaToStore(
      tx.objectStore('phishingAddresses'),
      delta.addresses.map(({ op, value }) => ({ op, value: value.toLowerCase() }))
    )

    tx.objectStore('phishingMeta')
      .put({ id: META_ID, version: meta.version, updatedAt: meta.updatedAt })
      .catch(() => {})

    await tx.done
  }

  /**
   * Read-modify-write, one bucket at a time — a bucket holds many entries, so a delta can no
   * longer put or delete a single key. Grouped first so a bucket several entries touch is read
   * once, not once per entry.
   *
   * A Set makes the operations idempotent, which matters because an aborted transaction leaves
   * the checkpoint unchanged and the same delta arrives again on the next fetch.
   */
  async #applyDeltaToStore(
    store: any,
    changes: { op: 'add' | 'remove'; value: string }[]
  ): Promise<void> {
    const byBucket = new Map<number, { add: string[]; remove: string[] }>()
    changes.forEach(({ op, value }) => {
      const id = phishingBucketOf(value)
      if (!byBucket.has(id)) byBucket.set(id, { add: [], remove: [] })
      byBucket.get(id)![op === 'add' ? 'add' : 'remove'].push(value)
    })

    for (const [id, ops] of byBucket) {
      const existing = await store.get(id)
      const entries = new Set<string>(existing?.entries ?? [])

      ops.remove.forEach((value) => entries.delete(value))
      ops.add.forEach((value) => entries.add(value))

      if (entries.size) store.put({ id, entries: [...entries] }).catch(() => {})
      else store.delete(id).catch(() => {})
    }
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
