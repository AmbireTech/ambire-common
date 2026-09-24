import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import {
  PhishingDelta,
  PhishingIdbStorage,
  PhishingKeyValueStorage,
  PhishingSnapshot
} from './phishingIdb'
import { AmbireIdbDatabase, openAmbireIdb, resetAmbireIdbForTesting } from './idbDatabase'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ADDR_A = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const ADDR_B = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

function makeSnapshot(overrides: Partial<PhishingSnapshot> = {}): PhishingSnapshot {
  return {
    version: 7,
    updatedAt: 1000,
    domains: ['phishing.example.com', 'scam.io'],
    addresses: [ADDR_A],
    ...overrides
  }
}

function makeDelta(overrides: Partial<PhishingDelta> = {}): PhishingDelta {
  return { domains: [], addresses: [], ...overrides }
}

/** Minimal in-memory IStorageController stub. */
function makeStorageMock(initial: Record<string, any> = {}) {
  const store: Record<string, any> = { ...initial }

  return {
    get: jest.fn(async (key: string, defaultValue: any) =>
      key in store ? JSON.parse(JSON.stringify(store[key])) : defaultValue
    ),
    set: jest.fn(async (key: string, value: any) => {
      store[key] = JSON.parse(JSON.stringify(value))

      return null
    }),
    remove: jest.fn(async (key: string) => {
      delete store[key]

      return null
    }),
    raw: store
  }
}

/**
 * Records which store each db call touches. `idb` returns a Proxy, so jest.spyOn cannot
 * install on it — wrapping is the only way to observe what a read actually reaches for.
 */
function recordingDb(target: AmbireIdbDatabase) {
  const touched: string[] = []
  const proxy = new Proxy(target as any, {
    get(obj, prop) {
      const value = obj[prop]
      if (typeof value !== 'function') return value

      return (...args: any[]) => {
        touched.push(`${String(prop)}(${String(args[0])})`)

        return value.apply(obj, args)
      }
    }
  })

  return { db: proxy as AmbireIdbDatabase, touched }
}

let db: AmbireIdbDatabase

beforeEach(async () => {
  resetAmbireIdbForTesting()
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
  db = await openAmbireIdb()
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PhishingIdbStorage — layout', () => {
  test('the three stores exist in the production schema', () => {
    expect(db.objectStoreNames.contains('phishingDomains')).toBe(true)
    expect(db.objectStoreNames.contains('phishingAddresses')).toBe(true)
    expect(db.objectStoreNames.contains('phishingMeta')).toBe(true)
  })

  test('one row per entry, keyed by the entry itself', async () => {
    await new PhishingIdbStorage(db).replaceAll(makeSnapshot())

    // The key IS the domain, so no index and no record read is needed to look one up
    expect(await db.getAllKeys('phishingDomains')).toEqual(['phishing.example.com', 'scam.io'])
    expect(await db.count('phishingDomains')).toBe(2)
    expect(await db.count('phishingAddresses')).toBe(1)
  })

  test('an empty store reports the default checkpoint rather than throwing', async () => {
    expect(await new PhishingIdbStorage(db).loadMeta()).toEqual({ version: 0, updatedAt: 0 })
  })
})

describe('PhishingIdbStorage — reads on demand', () => {
  test('a lookup finds an entry without loading the list', async () => {
    const store = new PhishingIdbStorage(db)
    await store.replaceAll(makeSnapshot())

    expect(await store.hasDomain('scam.io')).toBe(true)
    expect(await store.hasDomain('not-listed.example')).toBe(false)
    expect(await store.hasAddress(ADDR_A)).toBe(true)
    expect(await store.hasAddress(ADDR_B)).toBe(false)
  })

  test('addresses are matched whatever casing the caller passes', async () => {
    const store = new PhishingIdbStorage(db)
    // Stored uppercase by the relayer; lookups must not have to normalize first
    await store.replaceAll(makeSnapshot({ addresses: [ADDR_A.toUpperCase()] }))

    expect(await store.hasAddress(ADDR_A)).toBe(true)
    expect(await store.hasAddress(ADDR_A.toUpperCase())).toBe(true)
  })

  test('loadMeta reads the checkpoint only, never the entries', async () => {
    await new PhishingIdbStorage(db).replaceAll(makeSnapshot())

    // This is what makes a wake-up cheap: the entry stores are not touched at all
    const recorder = recordingDb(db)
    expect(await new PhishingIdbStorage(recorder.db).loadMeta()).toEqual({
      version: 7,
      updatedAt: 1000
    })

    expect(recorder.touched).toEqual(['get(phishingMeta)'])
  })

  test('a lookup reads one entry store and nothing else', async () => {
    await new PhishingIdbStorage(db).replaceAll(makeSnapshot())

    const recorder = recordingDb(db)
    await new PhishingIdbStorage(recorder.db).hasDomain('scam.io')

    expect(recorder.touched).toEqual(['getKey(phishingDomains)'])
  })
})

describe('PhishingIdbStorage — writes touch only what changed', () => {
  test('a delta adds and removes single entries, leaving the rest alone', async () => {
    const store = new PhishingIdbStorage(db)
    await store.replaceAll(makeSnapshot())

    await store.applyDelta(
      makeDelta({
        domains: [
          { op: 'add', value: 'new-scam.example' },
          { op: 'remove', value: 'scam.io' }
        ],
        addresses: [{ op: 'add', value: ADDR_B }]
      }),
      { version: 8, updatedAt: 2000 }
    )

    expect(await db.getAllKeys('phishingDomains')).toEqual([
      'new-scam.example',
      'phishing.example.com'
    ])
    expect(await store.hasAddress(ADDR_B)).toBe(true)
    expect(await store.hasAddress(ADDR_A)).toBe(true)
  })

  test('a delta advances the checkpoint in the same write', async () => {
    const store = new PhishingIdbStorage(db)
    await store.replaceAll(makeSnapshot())

    await store.applyDelta(makeDelta({ domains: [{ op: 'add', value: 'x.example' }] }), {
      version: 8,
      updatedAt: 2000
    })

    expect(await store.loadMeta()).toEqual({ version: 8, updatedAt: 2000 })
  })

  test('removing an entry that was never stored is a no-op, not a failure', async () => {
    const store = new PhishingIdbStorage(db)
    await store.replaceAll(makeSnapshot())

    await expect(
      store.applyDelta(makeDelta({ domains: [{ op: 'remove', value: 'never-listed.example' }] }), {
        version: 8,
        updatedAt: 2000
      })
    ).resolves.toBeUndefined()
    expect(await db.count('phishingDomains')).toBe(2)
  })

  test('a delta lowercases added addresses, so the stored form stays canonical', async () => {
    const store = new PhishingIdbStorage(db)
    await store.replaceAll(makeSnapshot({ addresses: [] }))

    await store.applyDelta(makeDelta({ addresses: [{ op: 'add', value: ADDR_B.toUpperCase() }] }), {
      version: 8,
      updatedAt: 2000
    })

    expect(await db.getAllKeys('phishingAddresses')).toEqual([ADDR_B])
  })

  test('a delta removes an address regardless of the casing it names', async () => {
    const store = new PhishingIdbStorage(db)
    await store.replaceAll(makeSnapshot())

    await store.applyDelta(
      makeDelta({ addresses: [{ op: 'remove', value: ADDR_A.toUpperCase() }] }),
      { version: 8, updatedAt: 2000 }
    )

    expect(await store.hasAddress(ADDR_A)).toBe(false)
  })

  test('a full refresh replaces both lists rather than merging into them', async () => {
    const store = new PhishingIdbStorage(db)
    await store.replaceAll(makeSnapshot())
    await store.replaceAll(
      makeSnapshot({ version: 9, domains: ['only-this.example'], addresses: [ADDR_B] })
    )

    expect(await db.getAllKeys('phishingDomains')).toEqual(['only-this.example'])
    expect(await store.hasDomain('scam.io')).toBe(false)
    expect(await store.hasAddress(ADDR_A)).toBe(false)
  })
})

describe('PhishingIdbStorage — migration out of key-value', () => {
  test('moves the legacy blob into rows, then drops the legacy key', async () => {
    const store = new PhishingIdbStorage(db)
    const getStored = jest.fn(async () => makeSnapshot())
    const removeStored = jest.fn(async () => {})

    await store.ensureMigrated(getStored, removeStored)

    expect(await store.hasDomain('scam.io')).toBe(true)
    expect(await store.loadMeta()).toEqual({ version: 7, updatedAt: 1000 })
    expect(removeStored).toHaveBeenCalled()
  })

  test('a second start does not migrate again', async () => {
    const store = new PhishingIdbStorage(db)
    await store.ensureMigrated(
      async () => makeSnapshot(),
      async () => {}
    )

    const getStored = jest.fn(async () => makeSnapshot())
    await store.ensureMigrated(getStored, async () => {})

    expect(getStored).not.toHaveBeenCalled()
  })

  test('a blank legacy payload is not migrated, so a later real one still can be', async () => {
    const store = new PhishingIdbStorage(db)
    const removeStored = jest.fn(async () => {})

    // Writing a meta row here would make isEmpty() skip the real migration forever
    await store.ensureMigrated(
      async () => ({ version: 0, updatedAt: 0, domains: [], addresses: [] }),
      removeStored
    )

    expect(await store.isEmpty()).toBe(true)
    expect(removeStored).not.toHaveBeenCalled()

    await store.ensureMigrated(
      async () => makeSnapshot(),
      async () => {}
    )
    expect(await store.hasDomain('scam.io')).toBe(true)
  })

  test('a failed removal still leaves the data migrated', async () => {
    const store = new PhishingIdbStorage(db)

    await expect(
      store.ensureMigrated(
        async () => makeSnapshot(),
        async () => {
          throw new Error('storage.remove failed')
        }
      )
    ).rejects.toThrow('storage.remove failed')

    // The rows landed before the removal was attempted
    expect(await store.hasDomain('scam.io')).toBe(true)
  })
})

describe('PhishingKeyValueStorage — the mobile path', () => {
  test('never migrates — the blob is already its final location', async () => {
    const getStored = jest.fn(async () => makeSnapshot())
    const removeStored = jest.fn(async () => {})

    await new PhishingKeyValueStorage(makeStorageMock() as any).ensureMigrated(
      getStored,
      removeStored
    )

    expect(getStored).not.toHaveBeenCalled()
    expect(removeStored).not.toHaveBeenCalled()
  })

  test('a delta is applied to the blob and the checkpoint advances', async () => {
    const storage = makeStorageMock()
    const store = new PhishingKeyValueStorage(storage as any)
    await store.replaceAll(makeSnapshot())

    await store.applyDelta(
      makeDelta({
        domains: [
          { op: 'add', value: 'new-scam.example' },
          { op: 'remove', value: 'scam.io' }
        ]
      }),
      { version: 8, updatedAt: 2000 }
    )

    const stored = storage.raw.phishing as PhishingSnapshot
    expect(stored.domains).toEqual(['phishing.example.com', 'new-scam.example'])
    expect(stored.version).toBe(8)
  })

  test('addresses are lowercased on write, matching the IDB backend', async () => {
    const storage = makeStorageMock()
    const store = new PhishingKeyValueStorage(storage as any)

    await store.replaceAll(makeSnapshot({ addresses: [ADDR_A.toUpperCase()] }))

    expect((storage.raw.phishing as PhishingSnapshot).addresses).toEqual([ADDR_A])
    expect(await store.hasAddress(ADDR_A.toUpperCase())).toBe(true)
  })
})
