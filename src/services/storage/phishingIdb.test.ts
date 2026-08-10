import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import {
  DEFAULT_PHISHING_SNAPSHOT,
  PhishingIdbStorage,
  PhishingKeyValueStorage,
  PhishingSnapshot
} from './phishingIdb'
import { AmbireIdbDatabase } from './idbDatabase'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<PhishingSnapshot> = {}): PhishingSnapshot {
  return {
    version: 1,
    updatedAt: 1000,
    domains: ['phishing.example.com', 'scam.io'],
    addresses: ['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
    ...overrides
  }
}

/**
 * Minimal in-memory IStorageController stub — only the methods used by
 * PhishingKeyValueStorage are needed here.
 */
function makeStorageMock(initial: Record<string, any> = {}) {
  const store: Record<string, any> = { ...initial }
  return {
    get: async (key: string, defaultValue: any) =>
      key in store ? JSON.parse(JSON.stringify(store[key])) : defaultValue,
    set: async (key: string, value: any) => {
      store[key] = JSON.parse(JSON.stringify(value))
      return null
    },
    remove: async (key: string) => {
      delete store[key]
      return null
    },
    _store: store
  }
}

let db: AmbireIdbDatabase

// Opens a minimal isolated DB with only the phishing store. Deliberately does NOT
// use openAmbireIdb(): the phishing store is not in AMBIRE_IDB_SCHEMA, because
// adding it would mean an unrollbackable dbVersion bump for a store nothing reads
// yet. Switch these to openAmbireIdb() in the change that wires PhishingController.
async function openTestDb(): Promise<AmbireIdbDatabase> {
  return openDB('phishing-unit-test', 1, {
    upgrade(d) {
      d.createObjectStore('phishing', { keyPath: 'id' })
    }
  })
}

beforeEach(async () => {
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
  // checkQuota() reads navigator.storage — stub it to avoid ReferenceError in Node.
  ;(global as any).navigator = {}
  db = await openTestDb()
})

// ─────────────────────────────────────────────────────────────────────────────
// PhishingIdbStorage (IDB / "dynamic" backend)
// ─────────────────────────────────────────────────────────────────────────────

describe('PhishingIdbStorage', () => {
  describe('isEmpty', () => {
    test('returns true on a fresh store', async () => {
      const store = new PhishingIdbStorage(db)
      expect(await store.isEmpty()).toBe(true)
    })

    test('returns false after a snapshot is saved', async () => {
      const store = new PhishingIdbStorage(db)
      await store.saveSnapshot(makeSnapshot())
      expect(await store.isEmpty()).toBe(false)
    })
  })

  describe('loadSnapshot', () => {
    test('returns DEFAULT_PHISHING_SNAPSHOT on an empty store', async () => {
      const store = new PhishingIdbStorage(db)
      expect(await store.loadSnapshot()).toEqual(DEFAULT_PHISHING_SNAPSHOT)
    })

    test('returns the saved snapshot after saveSnapshot', async () => {
      const store = new PhishingIdbStorage(db)
      const snap = makeSnapshot()
      await store.saveSnapshot(snap)
      expect(await store.loadSnapshot()).toEqual(snap)
    })

    test('does not expose the internal id field in the returned snapshot', async () => {
      const store = new PhishingIdbStorage(db)
      await store.saveSnapshot(makeSnapshot())
      const result = await store.loadSnapshot()
      expect(result).not.toHaveProperty('id')
    })

    test('returns independent objects — mutations to the result do not affect IDB', async () => {
      const store = new PhishingIdbStorage(db)
      await store.saveSnapshot(makeSnapshot())
      const result = await store.loadSnapshot()
      result.domains.push('injected.evil')
      const reloaded = await store.loadSnapshot()
      expect(reloaded.domains).not.toContain('injected.evil')
    })
  })

  describe('saveSnapshot', () => {
    test('round-trips every field', async () => {
      const store = new PhishingIdbStorage(db)
      const snap = makeSnapshot({
        version: 42,
        updatedAt: 9999,
        domains: ['evil.com', 'phish.io'],
        addresses: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1']
      })

      await store.saveSnapshot(snap)

      expect(await store.loadSnapshot()).toEqual(snap)
    })

    test('overwrites previous data on a second save', async () => {
      const store = new PhishingIdbStorage(db)
      await store.saveSnapshot(makeSnapshot({ version: 1, domains: ['old.com'] }))
      await store.saveSnapshot(makeSnapshot({ version: 2, domains: ['new.com'] }))
      const result = await store.loadSnapshot()
      expect(result.version).toBe(2)
      expect(result.domains).toEqual(['new.com'])
    })

    test('persists empty domains and addresses arrays without error', async () => {
      const store = new PhishingIdbStorage(db)
      await store.saveSnapshot(makeSnapshot({ domains: [], addresses: [] }))
      const result = await store.loadSnapshot()
      expect(result.domains).toEqual([])
      expect(result.addresses).toEqual([])
    })
  })

  describe('migrateFromStorage', () => {
    // migrateFromStorage delegates to saveSnapshot, which the block above covers
    // in full. One round-trip is enough to pin the delegation.
    test('imports a legacy snapshot and leaves the store non-empty', async () => {
      const store = new PhishingIdbStorage(db)
      const legacy = makeSnapshot({
        version: 7,
        updatedAt: 5000,
        domains: ['legacy-phish.com'],
        addresses: ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
      })

      await store.migrateFromStorage(legacy)

      expect(await store.loadSnapshot()).toEqual(legacy)
      expect(await store.isEmpty()).toBe(false)
    })
  })

  describe('ensureMigrated', () => {
    test('migrates when IDB is empty and storage has meaningful data', async () => {
      const store = new PhishingIdbStorage(db)
      const legacy = makeSnapshot({ version: 3 })
      const removeSpy = jest.fn(async () => {})

      await store.ensureMigrated(async () => legacy, removeSpy)

      const result = await store.loadSnapshot()
      expect(result.version).toBe(3)
      expect(result.domains).toEqual(legacy.domains)
      expect(removeSpy).toHaveBeenCalledTimes(1)
    })

    test('does not migrate when IDB already has a snapshot', async () => {
      const store = new PhishingIdbStorage(db)
      const existing = makeSnapshot({ version: 10, domains: ['already-there.com'] })
      await store.saveSnapshot(existing)

      const getStoredSpy = jest.fn(async () => makeSnapshot({ version: 99 }))
      const removeSpy = jest.fn(async () => {})

      await store.ensureMigrated(getStoredSpy, removeSpy)

      // Neither callback should be called — IDB already has data
      expect(getStoredSpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()

      // IDB data is unchanged
      const result = await store.loadSnapshot()
      expect(result.version).toBe(10)
    })

    test('does not migrate when storage also has no meaningful data', async () => {
      const store = new PhishingIdbStorage(db)
      const removeSpy = jest.fn(async () => {})

      // Storage returns the default (version=0, empty arrays)
      await store.ensureMigrated(async () => ({ ...DEFAULT_PHISHING_SNAPSHOT }), removeSpy)

      expect(await store.isEmpty()).toBe(true)
      expect(removeSpy).not.toHaveBeenCalled()
    })

    test('migrates when version is 0 but domains is non-empty — only the all-falsy case is skipped', async () => {
      // Guard: `!stored.version && !stored.domains.length && !stored.addresses.length`
      // Non-empty domains trigger migration even at version 0.
      const store = new PhishingIdbStorage(db)

      await store.ensureMigrated(
        async () => makeSnapshot({ version: 0, domains: ['early-phish.com'], addresses: [] }),
        async () => {}
      )

      const result = await store.loadSnapshot()
      expect(result.domains).toEqual(['early-phish.com'])
    })

    test('skips migration when only updatedAt is non-zero — updatedAt is not part of the guard', async () => {
      // The guard deliberately ignores updatedAt: a non-zero timestamp with no
      // domains or addresses does not represent meaningful phishing data.
      const store = new PhishingIdbStorage(db)
      const removeSpy = jest.fn(async () => {})

      await store.ensureMigrated(
        async () => ({ version: 0, updatedAt: 999, domains: [], addresses: [] }),
        removeSpy
      )

      expect(await store.isEmpty()).toBe(true)
      expect(removeSpy).not.toHaveBeenCalled()
    })

    test('an existing snapshot is fully preserved when migration is skipped', async () => {
      // Covers the restart case: a second ensureMigrated on a populated store must
      // neither overwrite nor merge the incoming legacy payload.
      const store = new PhishingIdbStorage(db)
      await store.saveSnapshot(
        makeSnapshot({ version: 10, domains: ['kept.com', 'also-kept.com'] })
      )

      await store.ensureMigrated(
        async () => makeSnapshot({ version: 99, domains: ['should-not-appear.evil'] }),
        async () => {}
      )

      const result = await store.loadSnapshot()
      expect(result.version).toBe(10)
      expect(result.domains).toEqual(['kept.com', 'also-kept.com'])
      expect(result.domains).not.toContain('should-not-appear.evil')
    })

    test('concurrent ensureMigrated calls on the same connection converge', async () => {
      // IDB-specific: two backend instances sharing one connection both observe
      // isEmpty()=true before either writes.
      const store1 = new PhishingIdbStorage(db)
      const store2 = new PhishingIdbStorage(db)
      const legacy = makeSnapshot({ version: 2, domains: ['concurrent.com'] })

      await Promise.all([
        store1.ensureMigrated(
          async () => legacy,
          async () => {}
        ),
        store2.ensureMigrated(
          async () => legacy,
          async () => {}
        )
      ])

      const result = await store1.loadSnapshot()
      expect(result.version).toBe(2)
      expect(result.domains).toEqual(['concurrent.com'])
    })

    test('error from getStoredData propagates and leaves IDB unchanged', async () => {
      const store = new PhishingIdbStorage(db)

      await expect(
        store.ensureMigrated(
          async () => {
            throw new Error('storage unavailable')
          },
          async () => {}
        )
      ).rejects.toThrow('storage unavailable')

      expect(await store.isEmpty()).toBe(true)
    })

    test('error from removeStoredData propagates after IDB was already written', async () => {
      const store = new PhishingIdbStorage(db)
      const legacy = makeSnapshot({ version: 3 })

      await expect(
        store.ensureMigrated(
          async () => legacy,
          async () => {
            throw new Error('remove failed')
          }
        )
      ).rejects.toThrow('remove failed')

      // IDB was written before removeStoredData was called
      expect(await store.isEmpty()).toBe(false)
      expect((await store.loadSnapshot()).version).toBe(3)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PhishingKeyValueStorage (chrome.storage.local / "static" backend)
// ─────────────────────────────────────────────────────────────────────────────

describe('PhishingKeyValueStorage', () => {
  describe('loadSnapshot', () => {
    test('returns DEFAULT_PHISHING_SNAPSHOT when storage is empty', async () => {
      const storage = makeStorageMock()
      const backend = new PhishingKeyValueStorage(storage as any)
      expect(await backend.loadSnapshot()).toEqual(DEFAULT_PHISHING_SNAPSHOT)
    })

    test('returns the snapshot already in storage', async () => {
      const snap = makeSnapshot({ version: 2, domains: ['stored.com'] })
      const storage = makeStorageMock({ phishing: snap })
      const backend = new PhishingKeyValueStorage(storage as any)
      expect(await backend.loadSnapshot()).toEqual(snap)
    })

    test('mutating the returned snapshot does not affect subsequent loads', async () => {
      const storage = makeStorageMock({ phishing: makeSnapshot({ domains: ['original.com'] }) })
      const backend = new PhishingKeyValueStorage(storage as any)

      const result = await backend.loadSnapshot()
      result.domains.push('injected.evil')

      const reloaded = await backend.loadSnapshot()
      expect(reloaded.domains).toEqual(['original.com'])
      expect(reloaded.domains).not.toContain('injected.evil')
    })
  })

  describe('saveSnapshot', () => {
    test('persists data so a subsequent loadSnapshot returns it', async () => {
      const storage = makeStorageMock()
      const backend = new PhishingKeyValueStorage(storage as any)
      const snap = makeSnapshot({ version: 3 })
      await backend.saveSnapshot(snap)
      expect(await backend.loadSnapshot()).toEqual(snap)
    })

    test('overwrites the previous snapshot on a second save', async () => {
      const storage = makeStorageMock()
      const backend = new PhishingKeyValueStorage(storage as any)
      await backend.saveSnapshot(makeSnapshot({ version: 1, domains: ['old.com'] }))
      await backend.saveSnapshot(makeSnapshot({ version: 2, domains: ['new.com'] }))
      const result = await backend.loadSnapshot()
      expect(result.version).toBe(2)
      expect(result.domains).toEqual(['new.com'])
    })

    test('mutating the snapshot object after saving does not affect subsequent loads', async () => {
      const storage = makeStorageMock()
      const backend = new PhishingKeyValueStorage(storage as any)
      const snap = makeSnapshot({ domains: ['original.com'] })

      await backend.saveSnapshot(snap)
      // Mutate the caller's object after the save — storage must be isolated
      snap.domains.push('injected-after-save.evil')

      const result = await backend.loadSnapshot()
      expect(result.domains).toEqual(['original.com'])
      expect(result.domains).not.toContain('injected-after-save.evil')
    })
  })

  describe('migration', () => {
    test('is entirely inert — the data already lives in its final location', async () => {
      const storage = makeStorageMock()
      const backend = new PhishingKeyValueStorage(storage as any)
      const getStoredSpy = jest.fn(async () => makeSnapshot())
      const removeSpy = jest.fn(async () => {})

      // Never reports empty, so ensureMigrated can never decide to migrate
      expect(await backend.isEmpty()).toBe(false)

      await backend.ensureMigrated(getStoredSpy, removeSpy)
      expect(getStoredSpy).not.toHaveBeenCalled()
      expect(removeSpy).not.toHaveBeenCalled()

      // An explicit import writes nothing either
      await backend.migrateFromStorage(makeSnapshot())
      expect(await backend.loadSnapshot()).toEqual(DEFAULT_PHISHING_SNAPSHOT)
    })
  })
})
