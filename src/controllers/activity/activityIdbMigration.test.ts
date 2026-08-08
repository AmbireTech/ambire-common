/**
 * ActivityController #load() — migration and startup-read behaviour.
 *
 * These cover the wiring rather than the storage primitives (those live in
 * services/storage/activityIdb.test.ts):
 *   - the legacy blob migrates into IDB before the first read
 *   - the legacy key is kept as a safety-net copy and the completion flag recorded
 *   - a restart skips migration and reads IDB
 *   - IDB going missing after a completed migration is surfaced, not silent
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
import { ActivityIdbStorage } from '../../services/storage/activityIdb'
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

function makeController(storage: IStorageController, idb?: AmbireIdbDatabase) {
  return new ActivityController(
    storage,
    (() => {}) as any,
    (() => {}) as any,
    alreadyLoaded, // accounts
    alreadyLoaded, // selectedAccount
    {} as any, // providers
    {} as any, // networks
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

  test('surfaces an error when IDB is missing after a migration already completed', async () => {
    // Previous session migrated into IDB and dropped the legacy key. This session
    // failed to open IDB, so the history exists but is unreachable. Reporting an
    // empty list here would look like data loss and would start a divergent blob.
    await (storage.set as (key: string, value: boolean) => Promise<void>)(
      'activityIdbMigrated',
      true
    )

    const controller = makeController(storage, undefined)
    await awaitLoad(controller)

    expect(controller.emittedErrors.length).toBeGreaterThan(0)
    const [error] = controller.emittedErrors
    expect(error?.level).toBe('major')
    expect(error?.message).toMatch(/transaction history/i)
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
