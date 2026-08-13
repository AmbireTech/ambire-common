/**
 * ActivityController #load() — migration and startup-read behaviour.
 *
 * These cover the wiring rather than the storage primitives (those live in
 * services/storage/activityIdb.test.ts):
 *   - the legacy blob migrates into IDB before the first read
 *   - the legacy key is kept as a safety-net copy and the completion flag recorded
 *   - a restart skips migration and reads IDB
 *   - IDB going missing after a completed migration degrades to the legacy blob
 *     quietly, without breaking the controller
 *
 * The controller dependencies are stubbed rather than built through
 * makeMainController: #load() only touches storage, the persistence backend, and
 * the two initialLoadPromise gates, so a full MainController would add seconds of
 * RPC mocking without covering anything extra.
 */

import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { IStorageController } from '../../interfaces/storage'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { ActivityIdbStorage, STARTUP_RECENT_OPS_LIMIT } from '../../services/storage/activityIdb'
import {
  AmbireIdbDatabase,
  openAmbireIdb,
  resetAmbireIdbForTesting
} from '../../services/storage/idbDatabase'
import { StorageController } from '../storage/storage'
import { ActivityController } from './activity'

import { produceMemoryStore } from '../../../test/helpers'

const ACC = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
const CHAIN_1 = 1n
const PROBE_ADDRESS = '0x0000000000000000000000000000000000000001'

function makeOp(id: string, timestamp: number, status = AccountOpStatus.Success) {
  return {
    id,
    accountAddr: ACC,
    chainId: CHAIN_1,
    calls: [] as { to: string; value: bigint; data: string }[],
    gasFeePayment: null,
    status,
    timestamp,
    identifiedBy: { type: 'Transaction', identifier: `0x${id}` }
  }
}

/** An op that sends to `to`, so it registers as a recipient in the history scan. */
function makeOpTo(id: string, timestamp: number, to: string) {
  return {
    ...makeOp(id, timestamp),
    calls: [{ to, value: 0n, data: '0x' }]
  }
}

/** A legacy accountsOps blob holding a single chain group for ACC. */
function legacyBlob(ops: ReturnType<typeof makeOp>[]) {
  return { [ACC]: { '1': ops } }
}

const alreadyLoaded = { initialLoadPromise: Promise.resolve() } as any

// filterAccountsOps reads #networks.networks, so anything exercising the filtered
// views needs real-looking chain ids here.
const networksStub = { networks: [{ chainId: CHAIN_1 }, { chainId: 137n }] } as any

function makeController(storage: IStorageController, idb?: AmbireIdbDatabase) {
  return new ActivityController(
    storage,
    (() => {}) as any,
    (() => {}) as any,
    { ...alreadyLoaded, accounts: [{ addr: ACC }] } as any, // accounts
    alreadyLoaded, // selectedAccount
    {} as any, // providers
    networksStub, // networks
    {} as any, // portfolio
    {} as any, // safe
    async () => {},
    undefined, // eventEmitterRegistry
    idb
  )
}

/**
 * Awaits the controller's private #initialLoadPromise. hasAccountOpsSentTo is the
 * cheapest public method that gates on it — everything it does afterwards is
 * in-memory, so it needs none of the stubbed dependencies.
 */
async function awaitLoad(controller: ActivityController) {
  await controller.hasAccountOpsSentTo(PROBE_ADDRESS, ACC)
}

/**
 * 'activityIdbMigrated' is not part of the shared StorageProps schema (see the
 * comment next to ActivityController#getActivityIdbMigrated) — reading and
 * writing it from outside the controller needs the same narrow casts.
 */
function getActivityIdbMigrated(storageToRead: IStorageController): Promise<boolean> {
  return (storageToRead.get as (key: string, defaultValue: boolean) => Promise<boolean>)(
    'activityIdbMigrated',
    false
  )
}

let db: AmbireIdbDatabase
let storage: IStorageController
let rawStore: ReturnType<typeof produceMemoryStore>

beforeEach(async () => {
  resetAmbireIdbForTesting()
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
  // checkQuota() reads navigator.storage — stub it to avoid a ReferenceError.
  ;(global as any).navigator = {}

  db = await openAmbireIdb()
  rawStore = produceMemoryStore()
  storage = new StorageController(rawStore)
})

describe('ActivityController — IDB migration on load', () => {
  test('migrates the legacy accountsOps blob into IDB before the first read', async () => {
    await storage.set('accountsOps', legacyBlob([makeOp('legacy-1', 1000)]) as any)

    await awaitLoad(makeController(storage, db))

    const rows = await new ActivityIdbStorage(db).getOpsForAccountAndChain(ACC, '1')
    expect(rows).toHaveLength(1)
    expect(rows?.[0]?.id).toBe('legacy-1')
  })

  test('keeps the legacy key as a safety-net copy and records the migrated flag', async () => {
    // The legacy key is intentionally NOT removed for now — see #migrateOpsToIdb.
    await storage.set('accountsOps', legacyBlob([makeOp('legacy-1', 1000)]) as any)

    await awaitLoad(makeController(storage, db))

    expect(await storage.get('accountsOps', {})).not.toEqual({})
    expect(await getActivityIdbMigrated(storage)).toBe(true)
  })

  test('a restart skips migration and keeps reading IDB, ignoring later legacy writes', async () => {
    await storage.set('accountsOps', legacyBlob([makeOp('migrated', 1000)]) as any)
    await awaitLoad(makeController(storage, db))

    // Something writes the legacy key again after the migration completed. IDB is
    // non-empty now, so it must be ignored rather than re-imported.
    await storage.set('accountsOps', legacyBlob([makeOp('stale', 9000)]) as any)

    await awaitLoad(makeController(storage, db))

    const ids = (await new ActivityIdbStorage(db).getOpsForAccountAndChain(ACC, '1'))?.map(
      (op) => op.id
    )
    expect(ids).toEqual(['migrated'])
    expect(ids).not.toContain('stale')
  })

  test('does nothing when there is no legacy data — no flag, no error', async () => {
    const controller = makeController(storage, db)
    await awaitLoad(controller)

    expect(await new ActivityIdbStorage(db).isEmpty()).toBe(true)
    expect(await getActivityIdbMigrated(storage)).toBe(false)
    expect(controller.emittedErrors).toHaveLength(0)
  })

  test('an unusable legacy op does not block the rest of the history', async () => {
    await storage.set('accountsOps', {
      [ACC]: {
        '1': [
          makeOp('good-1', 1000),
          // Row from an older app version with no timestamp
          { id: 'broken', accountAddr: ACC, chainId: CHAIN_1, status: 'success' },
          makeOp('good-2', 3000)
        ]
      }
    } as any)

    await awaitLoad(makeController(storage, db))

    const ids = (await new ActivityIdbStorage(db).getOpsForAccountAndChain(ACC, '1'))?.map(
      (op) => op.id
    )
    expect(ids).toEqual(['good-2', 'good-1'])
    // Migration completed despite the bad row, so the flag is recorded
    expect(await getActivityIdbMigrated(storage)).toBe(true)
  })

  test('a failed migration keeps the legacy key so the next start can retry', async () => {
    await storage.set('accountsOps', legacyBlob([makeOp('legacy-1', 1000)]) as any)

    // Break the legacy read so ensureMigrated rejects before writing anything
    const failing: IStorageController = Object.create(storage)
    failing.get = (async (key: string, defaultValue?: any) => {
      if (key === 'accountsOps') throw new Error('storage read failed')
      return (storage.get as any)(key, defaultValue)
    }) as IStorageController['get']

    const controller = makeController(failing, db)
    await awaitLoad(controller)

    // Init still completed, the failure was reported, and nothing was migrated
    expect(controller.emittedErrors.length).toBeGreaterThan(0)
    expect(await new ActivityIdbStorage(db).isEmpty()).toBe(true)
    expect(await storage.get('accountsOps', {})).not.toEqual({})
    expect(await getActivityIdbMigrated(storage)).toBe(false)
  })

  test('a failed migration still shows history, read from the retained legacy blob', async () => {
    // The IDB write fails, so IDB is left empty. Reading the startup set from IDB
    // would show an empty history for the whole session even though the legacy copy
    // is intact — the fallback is what keeping that copy is for.
    const RECIPIENT = '0xF0cD725D2195b1D3f4BD038c3786005B793237DB'
    await storage.set('accountsOps', legacyBlob([makeOpTo('legacy-op', 1000, RECIPIENT)]) as any)

    const spy = jest
      .spyOn(ActivityIdbStorage.prototype, 'migrateFromStorage')
      .mockRejectedValue(new Error('idb write failed') as never)

    const controller = makeController(storage, db)
    const result = await controller.hasAccountOpsSentTo(RECIPIENT, ACC)

    expect(result.found).toBe(true)
    expect(await new ActivityIdbStorage(db).isEmpty()).toBe(true)
    // Reported silently — the user still sees their history, so there is nothing
    // for them to act on
    expect(controller.emittedErrors.map((e) => e.level)).toContain('silent')

    spy.mockRestore()
  })

  test('a failed startup read leaves the controller usable rather than rejecting forever', async () => {
    // #load() runs from the constructor and is assigned to #initialLoadPromise,
    // which every public method awaits. If it rejects, the controller is bricked
    // for the session and the rejection is unhandled.
    const spy = jest
      .spyOn(ActivityIdbStorage.prototype, 'loadStartupOps')
      .mockRejectedValue(new Error('idb read failed') as never)

    const controller = makeController(storage, db)

    await expect(awaitLoad(controller)).resolves.toBeUndefined()
    expect(controller.emittedErrors.length).toBeGreaterThan(0)

    spy.mockRestore()
  })

  test('init survives when both the migration and the fallback read fail', async () => {
    // The legacy read itself is what broke, so the fallback throws too. Init must
    // still complete rather than leaving the controller permanently unloaded.
    const failing: IStorageController = Object.create(storage)
    failing.get = (async (key: string, defaultValue?: any) => {
      if (key === 'accountsOps') throw new Error('storage read failed')
      return (storage.get as any)(key, defaultValue)
    }) as IStorageController['get']

    const controller = makeController(failing, db)

    await expect(awaitLoad(controller)).resolves.toBeUndefined()
    expect(controller.emittedErrors.length).toBeGreaterThan(0)
  })
})

describe('ActivityController — key-value path (no IDB)', () => {
  test('never migrates and never sets the flag', async () => {
    await storage.set('accountsOps', legacyBlob([makeOp('kv-1', 1000)]) as any)

    const controller = makeController(storage, undefined)
    await awaitLoad(controller)

    // The blob stays exactly where it is — it is already the source of truth here
    expect(await storage.get('accountsOps', {})).not.toEqual({})
    expect(await getActivityIdbMigrated(storage)).toBe(false)
    expect(controller.emittedErrors).toHaveLength(0)
  })

  test('stays usable and silent when IDB is missing after a migration already completed', async () => {
    // Previous session migrated into IDB. This session failed to open IDB, so the
    // history exists but is unreachable. There is deliberately no user-facing surfacing
    // for this — what must hold is that the controller still loads and reads the
    // retained legacy blob instead of throwing or starting a divergent one.
    await (storage.set as (key: string, value: boolean) => Promise<void>)(
      'activityIdbMigrated',
      true
    )
    await storage.set('accountsOps', legacyBlob([makeOp('kv-1', 1000)]) as any)

    const controller = makeController(storage, undefined)
    await awaitLoad(controller)

    expect(controller.getAccountOpsForAccount({ accountAddr: ACC }).map((op) => op.id)).toEqual([
      'kv-1'
    ])
    expect(controller.emittedErrors).toHaveLength(0)
  })

  test('stays quiet when IDB is missing and no migration ever ran', async () => {
    const controller = makeController(storage, undefined)
    await awaitLoad(controller)

    expect(controller.emittedErrors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Full-history expansion
//
// The IDB startup read only holds STARTUP_RECENT_OPS_LIMIT finalized ops per
// chain. hasAccountOpsSentTo answers "have I ever sent here" and computes the
// address-poisoning match, both of which need the whole history — so it expands
// the cache on demand first.
// ─────────────────────────────────────────────────────────────────────────────

describe('ActivityController — full history expansion', () => {
  const OLD_RECIPIENT = '0xF0cD725D2195b1D3f4BD038c3786005B793237DB'

  /** Seeds IDB with `count` ops; the OLDEST one sends to OLD_RECIPIENT. */
  async function seedBeyondStartupWindow(count: number) {
    const ops = [
      makeOpTo('oldest', 1, OLD_RECIPIENT),
      ...Array.from({ length: count - 1 }, (_, i) => makeOp(`recent-${i}`, 1000 + i))
    ]
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, ops as any)
  }

  test('finds a recipient from an op older than the startup window', async () => {
    // 25 ops, so the oldest falls outside the 20 finalized loaded at startup.
    // Without expansion this reports found=false, and because the poisoning match
    // is computed from the same scan, a lookalike of OLD_RECIPIENT would raise no
    // warning on the send screen.
    await seedBeyondStartupWindow(25)

    const controller = makeController(storage, db)
    const result = await controller.hasAccountOpsSentTo(OLD_RECIPIENT, ACC)

    expect(result.found).toBe(true)
  })

  test('expands every scanned account when accountId is empty', async () => {
    // An empty accountId means "scan all accounts". The expansion used to be keyed
    // off that same empty argument, so it bailed immediately and the scan ran over
    // the truncated startup window for every account.
    await seedBeyondStartupWindow(25)

    const controller = makeController(storage, db)
    const result = await controller.hasAccountOpsSentTo(OLD_RECIPIENT, '')

    expect(result.found).toBe(true)
  })

  test('expands each account only once across repeated calls', async () => {
    await seedBeyondStartupWindow(25)
    const spy = jest.spyOn(ActivityIdbStorage.prototype, 'getOpsForAccountAndChain')

    const controller = makeController(storage, db)
    await controller.hasAccountOpsSentTo(OLD_RECIPIENT, ACC)
    const afterFirst = spy.mock.calls.length
    await controller.hasAccountOpsSentTo(OLD_RECIPIENT, ACC)

    // One fetch per chain on the first call, nothing on the second
    expect(afterFirst).toBe(1)
    expect(spy.mock.calls.length).toBe(afterFirst)
    spy.mockRestore()
  })

  test('does not touch IDB on the key-value path', async () => {
    await storage.set('accountsOps', legacyBlob([makeOpTo('kv', 1, OLD_RECIPIENT)]) as any)
    const spy = jest.spyOn(ActivityIdbStorage.prototype, 'getOpsForAccountAndChain')

    const controller = makeController(storage, undefined)
    const result = await controller.hasAccountOpsSentTo(OLD_RECIPIENT, ACC)

    // The key-value startup read already returns the full blob
    expect(result.found).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('a failed expansion is reported but still answers from the startup window', async () => {
    await seedBeyondStartupWindow(25)
    const spy = jest
      .spyOn(ActivityIdbStorage.prototype, 'getOpsForAccountAndChain')
      .mockRejectedValue(new Error('idb read failed') as never)

    const controller = makeController(storage, db)
    const result = await controller.hasAccountOpsSentTo(OLD_RECIPIENT, ACC)

    // Degraded, not broken: the recent window is still searched
    expect(result.found).toBe(false)
    expect(controller.emittedErrors.length).toBeGreaterThan(0)
    spy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Interactions between controller methods
//
// Each method below was already covered in isolation. These cover the SEQUENCES,
// which is where the real bugs were: a green suite of per-method tests missed all
// of them because none of them exercised two paths touching #accountsOps together.
// ─────────────────────────────────────────────────────────────────────────────

describe('ActivityController — method interactions', () => {
  const RECIPIENT = '0xF0cD725D2195b1D3f4BD038c3786005B793237DB'

  test('a new op is not dropped by a lazy-load triggered from the same call', async () => {
    // Regression: with an active chain-filtered session and a group inside the startup
    // window, addAccountOp's syncFilteredAccountsOps() lazy-loaded from IDB and
    // REPLACED the in-memory group, discarding the op that had just been unshifted.
    // The op reached disk but vanished from memory, so it was never polled to
    // confirmation.
    //
    // This asserts the OUTCOME, not a mechanism, so it needs both defects present to
    // fail: the per-group loaded flag (which stops the repeat lazy-load) and
    // the persistence-layer merge (which keeps memory-only ops) each independently prevent it.
    // Verified by restoring both the old length heuristic and replace-not-merge.
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('existing', 1000) as any
    ])

    const controller = makeController(storage, db)
    // Open a chain-filtered session, exactly as the history screen does
    await controller.filterAccountsOps('session-1', { account: ACC, chainId: CHAIN_1 })

    await controller.addAccountOp(makeOp('brand-new', 9000) as any)

    const ids = controller.getAccountOpsForAccount({ accountAddr: ACC }).map((op) => op.id)
    expect(ids).toContain('brand-new')
    expect(ids).toContain('existing')
  })

  test('a failed migration keeps writes out of IDB so the guard can retry', async () => {
    // Regression: on migration failure the session read the legacy blob but kept the
    // IDB backend, so the first write put one row into the empty store. isEmpty() was
    // then false forever and the real history was stranded permanently.
    await storage.set('accountsOps', legacyBlob([makeOp('legacy-1', 1000)]) as any)

    const spy = jest
      .spyOn(ActivityIdbStorage.prototype, 'migrateFromStorage')
      .mockRejectedValue(new Error('idb write failed') as never)

    const controller = makeController(storage, db)
    await awaitLoad(controller)
    await controller.addAccountOp(makeOp('written-after-failure', 9000) as any)

    // IDB must still be empty, so the next startup retries the migration
    expect(await new ActivityIdbStorage(db).isEmpty()).toBe(true)
    // ...and the op went to the legacy blob instead, so it is not lost
    const blob: any = await storage.get('accountsOps', {})
    const blobIds = Object.values(blob[ACC] ?? {})
      .flat()
      .map((op: any) => op.id)
    expect(blobIds).toContain('written-after-failure')

    spy.mockRestore()
  })

  test('pending ops pushing a group past the window do not block the lazy-load', async () => {
    // Regression: the gate was `inMemoryCount > STARTUP_RECENT_OPS_LIMIT`. Pending ops
    // are exempt from the 20-op cap, so 5 pending + 30 finalized arrives as 25 and the
    // heuristic wrongly concluded the group was already fully expanded — leaving
    // pagination showing 25 of 35.
    const pending = Array.from({ length: 5 }, (_, i) =>
      makeOp(`pending-${i}`, 5000 + i, AccountOpStatus.BroadcastedButNotConfirmed)
    )
    const finalized = Array.from({ length: 30 }, (_, i) => makeOp(`final-${i}`, 1000 + i))
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      ...pending,
      ...finalized
    ] as any)

    const controller = makeController(storage, db)
    await awaitLoad(controller)
    await controller.filterAccountsOps('session-1', { account: ACC, chainId: CHAIN_1 })

    // All 35 must be reachable, not just the startup slice
    const ids = controller.getAccountOpsForAccount({ accountAddr: ACC }).map((op) => op.id)
    expect(ids).toHaveLength(35)
    expect(ids).toContain('final-0')
  })

  test('an IDB user with no legacy blob still arms the stranded-history flag', async () => {
    // Regression: ensureMigrated only set the flag after moving a legacy blob, which
    // never happens for someone who installed after IDB became the default. The safety
    // net therefore never armed for new users: a later IDB failure showed an empty
    // history with no error at all.
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('idb-native', 1000) as any
    ])
    expect(await getActivityIdbMigrated(storage)).toBe(false)

    await awaitLoad(makeController(storage, db))

    expect(await getActivityIdbMigrated(storage)).toBe(true)
  })

  test('a brand-new wallet with no ops does not arm the flag', async () => {
    // The flag means "history lives in IDB". With no history there is nothing to warn
    // about, so a fresh wallet must not be told it lost something.
    await awaitLoad(makeController(storage, db))

    expect(await getActivityIdbMigrated(storage)).toBe(false)
  })

  test('init survives the post-load history checks throwing', async () => {
    // recording the migration flag was awaited unguarded at the end of #load, so a storage
    // failure there rejected #initialLoadPromise for the whole session — exactly the
    // failure mode guarded against 20 lines earlier in the same method.
    //
    // IDB must have ops for this to bite: the flag writer returns early on an
    // empty store, so without seeding, the flag is never read and the test would pass
    // whether or not the guard exists.
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('some-op', 1000) as any
    ])

    const failing: IStorageController = Object.create(storage)
    failing.get = (async (key: string, defaultValue?: any) => {
      if (key === 'activityIdbMigrated') throw new Error('flag read failed')
      return (storage.get as any)(key, defaultValue)
    }) as IStorageController['get']

    const controller = makeController(failing, db)

    await expect(awaitLoad(controller)).resolves.toBeUndefined()
    expect(controller.emittedErrors.length).toBeGreaterThan(0)
  })

  test('a failed startup read does not permanently mark history as expanded', async () => {
    // Regression: #ensureAccountHistoryLoaded marked an account fully-loaded whenever
    // it had no chains in memory. After a failed startup read that is every account,
    // so the poisoning scan silently had nothing to search for the rest of the session
    // even though IDB held the full history.
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOpTo('old-recipient', 1, RECIPIENT) as any
    ])

    const spy = jest
      .spyOn(ActivityIdbStorage.prototype, 'loadStartupOps')
      .mockRejectedValueOnce(new Error('idb read failed') as never)

    const controller = makeController(storage, db)
    await awaitLoad(controller)
    spy.mockRestore()

    // The startup read failed, so nothing is cached — but a later expansion must still
    // be attempted rather than short-circuited by a stale "already loaded" marker.
    await controller.filterAccountsOps('session-1', { account: ACC, chainId: CHAIN_1 })
    const ids = controller.getAccountOpsForAccount({ accountAddr: ACC }).map((op) => op.id)
    expect(ids).toContain('old-recipient')
  })
})

describe('ActivityController — merge-not-replace on lazy-load', () => {
  /**
   * Awaits #initialLoadPromise WITHOUT expanding history. awaitLoad() goes through
   * hasAccountOpsSentTo, which expands every group and marks it fully loaded — that
   * would stop filterAccountsOps from lazy-loading at all, so these tests would pass
   * whether or not the merge works. findMessage only touches #signedMessages.
   */
  const awaitLoadOnly = (controller: ActivityController) => controller.findMessage(ACC, () => true)

  test('an op that failed to persist still survives a later lazy-load', async () => {
    // Isolates the persistence-layer merge. If persisting fails the op exists ONLY in memory,
    // so a lazy-load that replaced the group with IDB content would erase it from the
    // UI on top of having failed to save it.
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('persisted', 1000) as any
    ])

    const spy = jest
      .spyOn(ActivityIdbStorage.prototype, 'putSingleOp')
      .mockRejectedValue(new Error('write failed') as never)

    const controller = makeController(storage, db)
    await awaitLoadOnly(controller)
    await controller.addAccountOp(makeOp('memory-only', 9000) as any)
    spy.mockRestore()

    // First lazy-load of this group, so the merge is what decides the outcome
    await controller.filterAccountsOps('session-1', { account: ACC, chainId: CHAIN_1 })

    const ids = controller.getAccountOpsForAccount({ accountAddr: ACC }).map((op) => op.id)
    expect(ids).toContain('memory-only')
    expect(ids).toContain('persisted')
  })

  test('merging keeps in-memory object identity so in-flight mutations stick', async () => {
    // updateAccountsOpsStatuses mutates op objects in place across long provider
    // awaits. A concurrent lazy-load that swapped in fresh objects from IDB would send
    // those mutations to detached copies, leaving the UI on stale state — so the
    // cached object has to win on an id collision.
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('shared', 1000, AccountOpStatus.BroadcastedButNotConfirmed) as any
    ])

    const controller = makeController(storage, db)
    await awaitLoadOnly(controller)

    const before = controller
      .getAccountOpsForAccount({ accountAddr: ACC })
      .find((op) => op.id === 'shared')!
    expect(before).toBeDefined()
    // Mutate in place, exactly as the status poller does
    before.status = AccountOpStatus.Success

    await controller.filterAccountsOps('session-1', { account: ACC, chainId: CHAIN_1 })

    const after = controller
      .getAccountOpsForAccount({ accountAddr: ACC })
      .find((op) => op.id === 'shared')!
    // Same object, so the mutation survived instead of being overwritten by the
    // still-pending row IDB returned
    expect(after).toBe(before)
    expect(after.status).toBe(AccountOpStatus.Success)
  })
})

describe('ActivityController — total transaction count', () => {
  // BannerController gates marketing banners on minTxnsTotal/maxTxnsTotal through a
  // SYNCHRONOUS callback (see the AccountData callback in main.ts), so the count has to
  // be cached. Using the in-memory group lengths instead reports the startup window and
  // puts heavy accounts in the wrong targeting bucket.
  const OVER_WINDOW = STARTUP_RECENT_OPS_LIMIT + 15

  // hasAccountOpsSentTo (what awaitLoad uses) expands the full history as a side effect,
  // which would hide the very gap these tests are about. findMessage only awaits the
  // load promise.
  const awaitLoadOnly = (controller: ActivityController) => controller.findMessage(ACC, () => true)

  test('reports the full persisted count, not the bounded startup window', async () => {
    const ops = Array.from({ length: OVER_WINDOW }, (_, i) => makeOp(`op-${i}`, 1000 + i) as any)
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, ops)

    const controller = makeController(storage, db)
    await awaitLoadOnly(controller)

    // The startup read deliberately holds fewer than this in memory
    expect(controller.getAccountOpsForAccount({ accountAddr: ACC }).length).toBeLessThan(
      OVER_WINDOW
    )
    expect(controller.getTotalOpsCountForAccount(ACC)).toBe(OVER_WINDOW)
  })

  test('the op counts are warmed after the first update, not before it', async () => {
    // finalizeInit() exists so counting (one backend query per account) cannot delay the
    // first paint of the history. Folding it back into init() would reintroduce that.
    const ops = Array.from({ length: OVER_WINDOW }, (_, i) => makeOp(`op-${i}`, 1000 + i) as any)
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, ops)

    const controller = makeController(storage, db)
    const countsAtFirstUpdate: number[] = []
    controller.onUpdate(() => countsAtFirstUpdate.push(controller.getTotalOpsCountForAccount(ACC)))

    await awaitLoadOnly(controller)

    // The first update fires with the count still unwarmed (the in-memory lower bound)
    expect(countsAtFirstUpdate[0]).toBeLessThan(OVER_WINDOW)
    // ...and the warm count is available once load settles
    expect(controller.getTotalOpsCountForAccount(ACC)).toBe(OVER_WINDOW)
  })

  test('an account with no history reports zero', async () => {
    const controller = makeController(storage, db)
    await awaitLoadOnly(controller)

    expect(controller.getTotalOpsCountForAccount(ACC)).toBe(0)
  })

  test('the count is exact on the key-value backend too', async () => {
    await storage.set(
      'accountsOps',
      legacyBlob([makeOp('kv-1', 1000), makeOp('kv-2', 2000)]) as any
    )

    const controller = makeController(storage, undefined)
    await awaitLoadOnly(controller)

    expect(controller.getTotalOpsCountForAccount(ACC)).toBe(2)
  })

  test('the mobile count reflects a newly added op with no refresh in between', async () => {
    // On the key-value backend #accountsOps IS the whole history, so the count reads it
    // live and the count refresh is skipped entirely — mobile does no extra work.
    //
    // NOTE: this asserts the observable guarantee, not the guard that provides it. The
    // loadsPartially check in AccountOpsPersistence.getTotalOpsCount is defensive: because the refresh
    // is gated too, the cache is always empty on this backend, so removing that check
    // still leaves the test passing. It earns its place by keeping the property true if
    // the refresh is ever un-gated.
    await storage.set('accountsOps', legacyBlob([makeOp('kv-1', 1000)]) as any)

    const controller = makeController(storage, undefined)
    await awaitLoadOnly(controller)
    expect(controller.getTotalOpsCountForAccount(ACC)).toBe(1)

    await controller.addAccountOp(makeOp('kv-2', 2000) as any)

    expect(controller.getTotalOpsCountForAccount(ACC)).toBe(2)
  })

  test('removing an account drops its cached count', async () => {
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('gone', 1000) as any
    ])

    const controller = makeController(storage, db)
    await awaitLoadOnly(controller)
    expect(controller.getTotalOpsCountForAccount(ACC)).toBe(1)

    await controller.removeAccountData(ACC)

    // A stale cached count would keep reporting the removed account's transactions
    expect(controller.getTotalOpsCountForAccount(ACC)).toBe(0)
  })
})

describe('ActivityController — bookkeeping around the expansion markers', () => {
  const awaitLoadOnly = (controller: ActivityController) => controller.findMessage(ACC, () => true)

  test('removing an account clears its expansion markers so a re-add re-reads IDB', async () => {
    // AccountOpsPersistence keys its expansion markers `${account}:${chainId}`, so removal has to clear by
    // prefix. A stale marker would make a re-added account look already-expanded and
    // permanently skip the lazy-load, showing only the startup window.
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('first-life', 1000) as any
    ])

    const controller = makeController(storage, db)
    // Expands chain 1 and marks it fully loaded
    await controller.hasAccountOpsSentTo(PROBE_ADDRESS, ACC)

    await controller.removeAccountData(ACC)

    // The account comes back with fresh history in IDB
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('second-life', 2000) as any
    ])
    await controller.filterAccountsOps('session-1', { account: ACC, chainId: CHAIN_1 })

    const ids = controller.getAccountOpsForAccount({ accountAddr: ACC }).map((op) => op.id)
    expect(ids).toContain('second-life')
  })

  test('a chain with no history is queried once, not on every update', async () => {
    // getOpsForAccountAndChain returns undefined for zero rows. Marking the group
    // loaded only on a non-empty result left every never-transacted-on chain unmarked,
    // so it was re-queried on each filterAccountsOps call — which runs on every
    // emitUpdate path.
    await new ActivityIdbStorage(db).putOpsForAccountAndChain(ACC, CHAIN_1, [
      makeOp('on-chain-1', 1000) as any
    ])

    const controller = makeController(storage, db)
    await awaitLoadOnly(controller)

    const spy = jest.spyOn(ActivityIdbStorage.prototype, 'getOpsForAccountAndChain')

    // Chain 137 is in the networks stub but the account has never used it
    await controller.filterAccountsOps('session-empty', { account: ACC, chainId: 137n })
    await controller.filterAccountsOps('session-empty', { account: ACC, chainId: 137n })
    await controller.filterAccountsOps('session-empty', { account: ACC, chainId: 137n })

    const emptyChainCalls = spy.mock.calls.filter(([, chainId]) => chainId === 137n)
    expect(emptyChainCalls).toHaveLength(1)

    spy.mockRestore()
  })

  // NOTE: there is deliberately no test asserting that persistence happens before
  // syncFilteredAccountsOps(). It must NOT — on the key-value backend putSingleOp
  // rewrites the whole blob, so awaiting it before emitUpdate would block the UI on a
  // full serialization of the history. the persistence-layer merge is what protects the new op,
  // and 'a new op is not dropped by a lazy-load triggered from the same call' plus the
  // merge tests cover that.
})
