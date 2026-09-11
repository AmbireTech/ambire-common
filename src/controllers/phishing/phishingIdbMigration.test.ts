/**
 * PhishingController #load() — backend selection and the one-time IDB migration.
 *
 * The existing phishing.test.ts builds the controller through makeMainController with no `idb`,
 * so it covers the key-value path and doubles as the mobile regression guard. These cover the
 * IDB path: that the legacy snapshot moves across before the first read, that the legacy key
 * is retained, and that later writes go to IDB only.
 */

import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { IStorageController } from '../../interfaces/storage'
import {
  AmbireIdbDatabase,
  openAmbireIdb,
  resetAmbireIdbForTesting
} from '../../services/storage/idbDatabase'
import { PhishingIdbStorage, PhishingSnapshot } from '../../services/storage/phishingIdb'
import { StorageController } from '../storage/storage'
import { PhishingController } from './phishing'

import { produceMemoryStore } from '../../../test/helpers'

const SNAPSHOT: PhishingSnapshot = {
  version: 7,
  updatedAt: 1_700_000_000_000,
  domains: ['evil.example'],
  addresses: ['0x000000000000000000000000000000000000dEaD']
}

// #load() kicks off the update interval, which fetches. Fail it fast so nothing hits network.
const failingFetch = (() => Promise.reject(new Error('offline in tests'))) as any

function makeController(storage: IStorageController, idb?: AmbireIdbDatabase) {
  return new PhishingController({
    fetch: failingFetch,
    storage,
    addressBook: { contacts: [] } as any,
    ui: { uiEvent: { on: () => {} }, views: [] } as any,
    idb
  })
}

/** Awaits initialLoadPromise, then stops the interval so Jest has no open handle. */
async function loadAndSettle(controller: PhishingController) {
  await controller.initialLoadPromise
  controller.updatePhishingInterval.stop()
}

let db: AmbireIdbDatabase
let storage: IStorageController

beforeEach(async () => {
  resetAmbireIdbForTesting()
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange

  db = await openAmbireIdb()
  storage = new StorageController(produceMemoryStore())
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('PhishingController — IDB migration on load', () => {
  test('the phishing store exists in the production schema', async () => {
    // Guards the manifest entry itself: without it reconcileSchema never creates the store and
    // every read below would throw NotFoundError instead of returning empty.
    expect(db.objectStoreNames.contains('phishing')).toBe(true)
  })

  test('migrates the legacy snapshot into IDB before the first read', async () => {
    await storage.set('phishing', SNAPSHOT)

    const controller = makeController(storage, db)
    await loadAndSettle(controller)

    expect(await new PhishingIdbStorage(db).loadSnapshot()).toEqual(SNAPSHOT)
    // The list itself is live in memory, which is what the UI reads
    expect(controller.getDomainBlacklistedStatus('https://evil.example')).toBe('BLACKLISTED')
  })

  test('keeps the legacy key as a fallback copy', async () => {
    // Unlike accountsOps this is a refetchable cache, so the copy is cheap — and it means a
    // session that cannot open IDB starts from real data rather than an empty list.
    await storage.set('phishing', SNAPSHOT)

    await loadAndSettle(makeController(storage, db))

    expect(await storage.get('phishing', null as any)).toEqual(SNAPSHOT)
  })

  test('a restart reads IDB and ignores a later write to the legacy key', async () => {
    await storage.set('phishing', SNAPSHOT)
    await loadAndSettle(makeController(storage, db))

    // Something writes the legacy key again after the migration completed
    await storage.set('phishing', { ...SNAPSHOT, domains: ['stale.example'] })

    const restarted = makeController(storage, db)
    await loadAndSettle(restarted)

    expect(restarted.getDomainBlacklistedStatus('https://evil.example')).toBe('BLACKLISTED')
    expect(restarted.getDomainBlacklistedStatus('https://stale.example')).not.toBe('BLACKLISTED')
  })

  test('does nothing when there is no legacy snapshot', async () => {
    const controller = makeController(storage, db)
    await loadAndSettle(controller)

    expect(await new PhishingIdbStorage(db).isEmpty()).toBe(true)
    expect(controller.emittedErrors.filter((e) => e.level !== 'silent')).toHaveLength(0)
  })

  test('a failed migration still loads and reports silently', async () => {
    await storage.set('phishing', SNAPSHOT)
    jest
      .spyOn(PhishingIdbStorage.prototype, 'ensureMigrated')
      .mockRejectedValueOnce(new Error('idb write failed') as never)

    const controller = makeController(storage, db)
    await loadAndSettle(controller)

    // Degraded, not broken: the controller finished loading and said so silently
    expect(controller.emittedErrors.some((e) => e.level === 'silent')).toBe(true)
  })

  test('a failed read falls back to the retained legacy copy, and still starts updating', async () => {
    // The realistic trigger: a database created by an earlier build of this branch, which is
    // already at v1 and therefore never runs onupgradeneeded again, so it has no 'phishing'
    // store and every read throws NotFoundError.
    //
    // Unguarded this rejected #load(), which has no catch — an unhandled rejection, no update
    // interval, and an EMPTY BLOCKLIST for the whole session.
    await storage.set('phishing', SNAPSHOT)
    jest
      .spyOn(PhishingIdbStorage.prototype, 'loadSnapshot')
      .mockRejectedValue(new Error('NotFoundError') as never)

    const controller = makeController(storage, db)
    await expect(controller.initialLoadPromise).resolves.toBeUndefined()
    controller.updatePhishingInterval.stop()

    // Protection intact, from the copy we deliberately kept
    expect(controller.getDomainBlacklistedStatus('https://evil.example')).toBe('BLACKLISTED')
    expect(controller.emittedErrors.some((e) => e.level === 'silent')).toBe(true)
  })

  test('version survives the migration, so updates stay incremental', async () => {
    // #version is private, but it selects the request: set means get_update?version=N,
    // unset means downloading the whole list. Losing it in the round trip would be invisible
    // except as a permanently full refetch.
    await storage.set('phishing', SNAPSHOT)
    const urls: string[] = []
    const recordingFetch = ((url: string) => {
      urls.push(url)

      return Promise.reject(new Error('offline in tests'))
    }) as any

    const controller = new PhishingController({
      fetch: recordingFetch,
      storage,
      addressBook: { contacts: [] } as any,
      ui: { uiEvent: { on: () => {} }, views: [] } as any,
      idb: db
    })
    await controller.initialLoadPromise
    controller.updatePhishingInterval.stop()

    expect(urls.some((u) => u.includes(`version=${SNAPSHOT.version}`))).toBe(true)
  })

  test('the key-value path never touches IDB', async () => {
    await storage.set('phishing', SNAPSHOT)
    const spy = jest.spyOn(PhishingIdbStorage.prototype, 'loadSnapshot')

    const controller = makeController(storage, undefined)
    await loadAndSettle(controller)

    expect(spy).not.toHaveBeenCalled()
    expect(controller.getDomainBlacklistedStatus('https://evil.example')).toBe('BLACKLISTED')
  })
})
