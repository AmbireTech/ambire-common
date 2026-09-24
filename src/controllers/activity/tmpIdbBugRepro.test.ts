/**
 * TEMPORARY — reproduces review findings on PR #2513
 *
 * !!!DELETE BEFORE MERGING!!!
 *
 * Assertions describe the CORRECT (pre-PR) behaviour. Where both backends run, the key-value
 * run is the control and passes; a failing IDB run proves the regression. Bug 4 fails on
 * both — the PR removed normalizeTxnId() from both adapters' guards.
 * Finding 6 (removal vs key casing) and 10 (recipient seeding) were not reproducible as
 * regressions and are left out.
 */

import 'fake-indexeddb/auto'

import { getAddress } from 'ethers'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { IStorageController } from '../../interfaces/storage'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { ActivityIdbStorage } from '../../services/storage/activityIdb'
import {
  AmbireIdbDatabase,
  openAmbireIdb,
  resetAmbireIdbForTesting
} from '../../services/storage/idbDatabase'
import { AMBIRE_IDB_SCHEMA } from '../../services/storage/idbSchema'
import { StorageController } from '../storage/storage'
import { ActivityController } from './activity'

const ACC_A = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
const ACC_B = getAddress('0x1111111111111111111111111111111111111111')
const RECIPIENT = '0x0000000000000000000000000000000000000001'
const TXN_ID = `0x${'ab'.repeat(32)}`

type Backend = 'keyValue' | 'idb'
const BACKENDS: Backend[] = ['keyValue', 'idb']

function makeOp(
  accountAddr: string,
  id: string,
  timestamp: number,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    accountAddr,
    chainId: 1n,
    calls: [{ to: RECIPIENT, value: 0n, data: '0x' }],
    gasFeePayment: null,
    status: AccountOpStatus.Success,
    timestamp,
    identifiedBy: { type: 'Transaction', identifier: `0x${id}` },
    ...extra
  }
}

let db: AmbireIdbDatabase
let rawStore: ReturnType<typeof produceMemoryStore>
let storage: IStorageController

beforeEach(async () => {
  resetAmbireIdbForTesting()
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
  db = await openAmbireIdb()
  rawStore = produceMemoryStore()
  storage = new StorageController(rawStore)
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** Seed the legacy blob as an upgrading user has it on disk. */
async function seedLegacyOps(ops: unknown) {
  await rawStore.set('accountsOps', ops as any)
  storage = new StorageController(rawStore)
  await storage.get('accountsOps', {})
}

function makeController(
  backend: Backend,
  {
    selectedAccount,
    callRelayer = () => {},
    providers = {}
  }: { selectedAccount: { account?: { addr: string } }; callRelayer?: any; providers?: any }
) {
  return new ActivityController(
    storage,
    (() => {}) as any,
    callRelayer,
    {
      initialLoadPromise: Promise.resolve(),
      accounts: [{ addr: ACC_A }, { addr: ACC_B }]
    } as any,
    Object.assign(selectedAccount, { initialLoadPromise: Promise.resolve() }) as any, // same ref, so a test can switch account
    providers,
    { networks: [{ chainId: 1n }] } as any,
    { addTokensToBeLearned: () => {} } as any,
    {} as any,
    async () => {},
    undefined,
    backend === 'idb' ? db : undefined
  )
}

const awaitLoad = (controller: ActivityController) => controller.findMessage(ACC_A, () => true)

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1 — the startup window is scoped to the boot account and never re-scoped
// loadStartupOps() loads finalized ops only for the account selected at boot (others get
// pending only), and nothing reloads them on account switch. Sync readers of #accountsOps —
// nonce.ts, swapAndBridge, wallet_getCallsStatus, the same-EOA-nonce check in status
// polling — then see an empty history for every other account until Activity is opened.
// ─────────────────────────────────────────────────────────────────────────────

describe.each(BACKENDS)('Bug 1 — non-boot account history [%s]', (backend) => {
  const B_FINALIZED = 5

  beforeEach(async () => {
    await seedLegacyOps({
      [ACC_A]: { '1': [makeOp(ACC_A, 'a1', 3000), makeOp(ACC_A, 'a2', 2000)] },
      [ACC_B]: {
        '1': Array.from({ length: B_FINALIZED }, (_, i) => makeOp(ACC_B, `b${i}`, 1000 - i))
      }
    })
  })

  test('NOT A BUG (review claim retracted): after switching A → B, B total count is right', async () => {
    const selected = { account: { addr: ACC_A } }
    const controller = makeController(backend, { selectedAccount: selected })
    await awaitLoad(controller)

    selected.account = { addr: ACC_B } // user switches account

    expect(controller.getTotalOpsCountForAccount(ACC_B)).toBe(B_FINALIZED)
  })

  test('BUG: after switching A → B, the last 5 txns are visible (nonce.ts:43 / swapAndBridge.ts:2480)', async () => {
    const selected = { account: { addr: ACC_A } }
    const controller = makeController(backend, { selectedAccount: selected })
    await awaitLoad(controller)

    selected.account = { addr: ACC_B }

    // Exactly the call nonce.ts makes (it defaults to the selected account).
    expect(controller.getAccountOpsForAccount({ from: 0, numberOfItems: 5 })).toHaveLength(5)
  })

  test('BUG: wallet_getCallsStatus for B finds its finalized op (ProviderController.ts:576)', async () => {
    const controller = makeController(backend, { selectedAccount: { account: { addr: ACC_A } } })
    await awaitLoad(controller)

    const found = controller.findByIdentifiedBy(
      { type: 'Transaction', identifier: '0xb0' } as any,
      ACC_B,
      1n
    )
    expect(found?.id).toBe('b0')
  })

  test('BUG: status polling on B detects a confirmed op with the same EOA nonce → UnknownButPastNonce', async () => {
    await seedLegacyOps({
      [ACC_B]: {
        '1': [
          makeOp(ACC_B, 'replacement', 2000, { eoaNonce: 7 }),
          makeOp(ACC_B, 'stale-pending', 1000, {
            eoaNonce: 7,
            status: AccountOpStatus.BroadcastedButNotConfirmed
          })
        ]
      }
    })

    const provider = {
      getTransactionReceipt: jest.fn(async () => null),
      getTransaction: jest.fn(async () => null)
    }
    const controller = makeController(backend, {
      selectedAccount: { account: { addr: ACC_A } },
      providers: { providers: { '1': provider } }
    })
    await awaitLoad(controller)

    await controller.updateAccountsOpsStatuses([ACC_B])

    const op = controller.findByIdentifiedBy(
      { type: 'Transaction', identifier: '0xstale-pending' } as any,
      ACC_B,
      1n
    )
    expect(op?.status).toBe(AccountOpStatus.UnknownButPastNonce)
    // The pre-PR path decides from history alone, without touching the RPC.
    expect(provider.getTransactionReceipt).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2 — in-place mutations outside updatedAccountsOps are never persisted
// persistAccountsOps() now writes only the ops updateOpStatus() returned. Fields mutated in
// place while the op stays pending (relayer/bundler txnId, front-ran txnId, MultipleTxns call
// statuses) never reach IDB — the old full-blob write saved them. The by-txn-id index misses
// the txnId, and a service-worker restart forgets it.
// ─────────────────────────────────────────────────────────────────────────────

/** A relayer op whose txnId the relayer returns now, but which is not mined yet. */
function relayerSetup(backend: Backend) {
  const callRelayer = jest.fn(async () => ({ data: { txId: TXN_ID } }))
  const provider = {
    getTransactionReceipt: jest.fn(async () => null),
    getTransaction: jest.fn(async () => ({ hash: TXN_ID })), // in the mempool
    getBlock: jest.fn(async () => null)
  }
  const makeCtrl = () =>
    makeController(backend, {
      selectedAccount: { account: { addr: ACC_A } },
      callRelayer,
      providers: { providers: { '1': provider } }
    })

  return { makeCtrl, provider }
}

const relayerOp = () =>
  makeOp(ACC_A, 'relayer-op', Date.now(), {
    status: AccountOpStatus.BroadcastedButNotConfirmed,
    identifiedBy: { type: 'Relayer', identifier: 'relayer-id' }
  })

describe.each(BACKENDS)('Bug 2 — txnId learned while pending [%s]', (backend) => {
  test('BUG: the txnId fetched from the relayer survives a service-worker restart', async () => {
    const { makeCtrl } = relayerSetup(backend)
    const controller = makeCtrl()
    await awaitLoad(controller)
    await controller.addAccountOp(relayerOp() as any)

    await controller.updateAccountsOpsStatuses([ACC_A])

    const inMemory = controller.findByIdentifiedBy(
      { type: 'Relayer', identifier: 'relayer-id' } as any,
      ACC_A,
      1n
    )
    expect(inMemory?.txnId).toBe(TXN_ID) // sanity: the mutation happened

    // Service worker restarts: a fresh controller over the same storage / IDB.
    const restarted = makeCtrl()
    await awaitLoad(restarted)
    const afterRestart = restarted.findByIdentifiedBy(
      { type: 'Relayer', identifier: 'relayer-id' } as any,
      ACC_A,
      1n
    )
    expect(afterRestart?.txnId).toBe(TXN_ID)
  })

  test('BUG: the stored txnId index knows the txnId', async () => {
    if (backend === 'keyValue') return // key-value has no separate index

    const { makeCtrl } = relayerSetup(backend)
    const controller = makeCtrl()
    await awaitLoad(controller)
    await controller.addAccountOp(relayerOp() as any)
    await controller.updateAccountsOpsStatuses([ACC_A])

    expect(await new ActivityIdbStorage(db).hasOpWithTxnId(ACC_A, TXN_ID)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 3 — the duplicate guard no longer checks the in-memory ops
// #addExternalAccountOp's guard asks only the backend (hasOpWithTxnId). An internal op that is
// in memory but not yet in IDB — its txnId unsaved (Bug 2), or addOp's write still in flight
// since it now runs after syncFilteredAccountsOps — is invisible to it, so the transfer
// scanner stores an external duplicate. Pre-PR the guard scanned #accountsOps in memory.
// ─────────────────────────────────────────────────────────────────────────────

const receipt = {
  hash: TXN_ID,
  status: 1,
  to: RECIPIENT,
  blockNumber: 123,
  blockHash: `0x${'1'.repeat(64)}`,
  gasUsed: 21000n,
  logs: []
} as any

async function storedExternalIds() {
  const external = await storage.get('externalAccountOps', {})

  return Object.values(external[ACC_A] ?? {})
    .flat()
    .map((op: any) => op.id)
}

describe.each(BACKENDS)('Bug 3 — external duplicate of an internal op [%s]', (backend) => {
  test('BUG: scanner reports a pending relayer op (txnId known only in memory) → no duplicate', async () => {
    const { makeCtrl } = relayerSetup(backend)
    const controller = makeCtrl()
    await awaitLoad(controller)
    await controller.addAccountOp(relayerOp() as any)
    await controller.updateAccountsOpsStatuses([ACC_A]) // txnId now set in memory

    await controller.addExternalAccountOp({
      accountAddr: ACC_A,
      chainId: 1n,
      txnId: TXN_ID,
      receipt
    })

    expect(await storedExternalIds()).toEqual([])
  })

  test('BUG: scanner reports an EOA op while its addOp write is still in flight → no duplicate', async () => {
    let releaseWrite!: () => void
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    // Hold the row write (both backends) so the op exists in memory but not yet on disk.
    const hold = (proto: any) => {
      const original = proto.putSingleOp
      jest.spyOn(proto, 'putSingleOp').mockImplementation(async function (
        this: any,
        ...args: any[]
      ) {
        await writeHeld
        return original.apply(this, args)
      })
    }
    const { ActivityKeyValueStorage } = await import('../../services/storage/activityIdb')
    hold(ActivityIdbStorage.prototype)
    hold(ActivityKeyValueStorage.prototype)

    const { makeCtrl } = relayerSetup(backend)
    const controller = makeCtrl()
    await awaitLoad(controller)

    const eoaOp = makeOp(ACC_A, 'eoa-op', Date.now(), {
      status: AccountOpStatus.BroadcastedButNotConfirmed,
      txnId: TXN_ID,
      identifiedBy: { type: 'Transaction', identifier: TXN_ID }
    })
    const adding = controller.addAccountOp(eoaOp as any)
    // Let addAccountOp reach the held write.
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(controller.getAccountOpsForAccount({ accountAddr: ACC_A })).toHaveLength(1)

    await controller.addExternalAccountOp({
      accountAddr: ACC_A,
      chainId: 1n,
      txnId: TXN_ID,
      receipt
    })

    releaseWrite()
    await adding

    expect(await storedExternalIds()).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 4 — txnId comparison became case-sensitive
// Pre-PR the duplicate guard compared with normalizeTxnId() (lowercase), added on purpose in
// a79a2c09b. Now IDB matches with IDBKeyRange.only(txnId) against the stored txnIds as-is, and
// the key-value adapter uses `id === txnId`. A hash that differs only in letter case (e.g. a
// relayer/indexer returning mixed-case hex) slips past the guard on BOTH backends.
// ─────────────────────────────────────────────────────────────────────────────

describe.each(BACKENDS)('Bug 4 — txnId letter case [%s]', (backend) => {
  test('control: same-case hash → no duplicate (the guard itself works)', async () => {
    const MIXED_CASE_TXN_ID = `0x${'AB'.repeat(32)}`
    await seedLegacyOps({
      [ACC_A]: { '1': [makeOp(ACC_A, 'mixed', 1000, { txnId: MIXED_CASE_TXN_ID })] }
    })
    const { makeCtrl } = relayerSetup(backend)
    const controller = makeCtrl()
    await awaitLoad(controller)

    await controller.addExternalAccountOp({
      accountAddr: ACC_A,
      chainId: 1n,
      txnId: MIXED_CASE_TXN_ID,
      receipt
    })

    expect(await storedExternalIds()).toEqual([])
  })

  test('BUG: scanner reports a lowercase hash of an internal op stored in mixed case → no duplicate', async () => {
    const MIXED_CASE_TXN_ID = `0x${'AB'.repeat(32)}`
    await seedLegacyOps({
      [ACC_A]: { '1': [makeOp(ACC_A, 'mixed', 1000, { txnId: MIXED_CASE_TXN_ID })] }
    })
    const { makeCtrl } = relayerSetup(backend)
    const controller = makeCtrl()
    await awaitLoad(controller)

    await controller.addExternalAccountOp({
      accountAddr: ACC_A,
      chainId: 1n,
      txnId: MIXED_CASE_TXN_ID.toLowerCase(),
      receipt
    })

    expect(await storedExternalIds()).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 5 — a removed account's history is resurrected by an in-flight status poll
// updateOps() is a blind IDB put(), i.e. an upsert. If removeAccountData() runs while a status
// poll is awaiting a receipt, the poll then persists its updated op and re-creates the row the
// removal just deleted. Pre-PR the write serialized #accountsOps, which no longer held the
// account, so nothing came back.
// ─────────────────────────────────────────────────────────────────────────────

describe.each(BACKENDS)('Bug 5 — removal racing a status poll [%s]', (backend) => {
  test('BUG: history removed mid-poll stays removed after a restart', async () => {
    let releaseReceipt!: () => void
    const receiptHeld = new Promise<void>((resolve) => {
      releaseReceipt = resolve
    })
    const provider = {
      getTransactionReceipt: jest.fn(async () => {
        await receiptHeld
        return { ...receipt, fee: 1n, gasPrice: 1n, from: ACC_A }
      }),
      getTransaction: jest.fn(async () => null),
      getBlock: jest.fn(async () => null)
    }
    const makeCtrl = () =>
      makeController(backend, {
        selectedAccount: { account: { addr: ACC_A } },
        providers: { providers: { '1': provider } }
      })

    const controller = makeCtrl()
    await awaitLoad(controller)
    await controller.addAccountOp(
      makeOp(ACC_A, 'pending', Date.now(), {
        status: AccountOpStatus.BroadcastedButNotConfirmed,
        txnId: TXN_ID,
        identifiedBy: { type: 'Transaction', identifier: TXN_ID }
      }) as any
    )

    const polling = controller.updateAccountsOpsStatuses([ACC_A])
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(provider.getTransactionReceipt).toHaveBeenCalled() // poll is now waiting

    await controller.removeAccountData(ACC_A)
    releaseReceipt()
    await polling

    const restarted = makeCtrl()
    await awaitLoad(restarted)
    expect(restarted.getAccountOpsForAccount({ accountAddr: ACC_A })).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 7 (PERF) — every re-filter re-reads the page from IDB, even when nothing changed
// syncFilteredAccountsOps() calls filterAccountsOps() for every open session on every status
// update. Each call runs getRecentOps() per enabled chain — a one-row-per-round-trip cursor of
// (page+1)*itemsPerPage rows — plus one count() per chain, although the cache already holds
// that page. Nothing remembers how deep each group was loaded.
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 7 (PERF) — repeated page reads [idb]', () => {
  test('BUG: re-filtering an unchanged, already-loaded page does not hit IDB again', async () => {
    await seedLegacyOps({
      [ACC_A]: { '1': Array.from({ length: 30 }, (_, i) => makeOp(ACC_A, `op${i}`, 5000 - i)) }
    })
    const controller = makeController('idb', { selectedAccount: { account: { addr: ACC_A } } })
    await awaitLoad(controller)
    await controller.filterAccountsOps('s1', { account: ACC_A }, { fromPage: 1, itemsPerPage: 10 })

    const recentReads = jest.spyOn(ActivityIdbStorage.prototype, 'getRecentOps')
    const counts = jest.spyOn(ActivityIdbStorage.prototype, 'countOpsForAccount')

    // What syncFilteredAccountsOps does on each of three status updates.
    for (let i = 0; i < 3; i++) {
      await controller.filterAccountsOps(
        's1',
        { account: ACC_A },
        { fromPage: 1, itemsPerPage: 10 }
      )
    }

    expect(recentReads).not.toHaveBeenCalled()
    expect(counts).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 8 — openAmbireIdb() has no timeout, and background init awaits it
// background.ts awaits openAmbireIdb() before constructing MainController and only falls back to
// key-value when it REJECTS. An open that never settles — a `blocked` upgrade (the `blocked`
// handler only logs), or a stuck browser profile — leaves init hanging and the wallet never
// boots. Reproduced with a real blocked upgrade: an older connection ignoring versionchange.
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 8 — blocked IDB upgrade', () => {
  test('BUG: openAmbireIdb() settles (so init can fall back) when an upgrade is blocked', async () => {
    db.close()
    // Another context (tab/page of the previous build) holding a connection that does not
    // close on versionchange — the standard way an upgrade gets blocked.
    const otherContext = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(AMBIRE_IDB_SCHEMA.dbName, AMBIRE_IDB_SCHEMA.dbVersion)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    const shippedVersion = AMBIRE_IDB_SCHEMA.dbVersion
    AMBIRE_IDB_SCHEMA.dbVersion = shippedVersion + 1 // the next release bumps the schema
    resetAmbireIdbForTesting()
    try {
      const outcome = await Promise.race([
        openAmbireIdb().then(
          () => 'resolved',
          () => 'rejected'
        ),
        new Promise((resolve) => {
          setTimeout(() => resolve('still pending'), 2000)
        })
      ])

      expect(outcome).not.toBe('still pending')
    } finally {
      AMBIRE_IDB_SCHEMA.dbVersion = shippedVersion
      otherContext.close()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 9 — history written during a key-value fallback session is lost when IDB returns
// Session 1 migrates to IDB. Session 2 cannot open IDB, falls back to key-value and writes new
// ops into the legacy blob. Session 3 opens IDB again: isEmpty() is false so nothing is
// re-merged, and #recordActiveBackend only reports the idb→keyValue direction, so session 2's
// transactions silently disappear.
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 9 — idb → keyValue → idb sessions', () => {
  test('BUG: an op sent while IDB was unavailable is still in history once IDB is back', async () => {
    await seedLegacyOps({ [ACC_A]: { '1': [makeOp(ACC_A, 'before', 1000)] } })
    const selected = { selectedAccount: { account: { addr: ACC_A } } }

    const session1 = makeController('idb', selected)
    await awaitLoad(session1)

    const session2 = makeController('keyValue', selected)
    await awaitLoad(session2)
    await session2.addAccountOp(makeOp(ACC_A, 'during-fallback', 2000) as any)

    const session3 = makeController('idb', selected)
    await awaitLoad(session3)

    const ids = session3.getAccountOpsForAccount({ accountAddr: ACC_A }).map((op) => op.id)
    expect(ids).toContain('during-fallback')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Not unit-testable — verify manually
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Bug 10 — recipient-index seeding failure is swallowed, never reaches Sentry
// StorageController.#indexSentToHistoryFromAccountsOps runs inside the shared migrations try,
// whose catch only console.error()s. If it throws (storage.set failure, malformed legacy op),
// it is never marked passed, re-reads the whole legacy blob on every startup, and
// hasAccountOpsSentTo — now answered from that index alone — silently misses known recipients.
// Check: make the method throw, restart; no Sentry event, retries every boot, "first time" warns.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Bug 11 — `idb` / `fake-indexeddb` are not declared at the root
// ambire-common declares idb ^8.0.3, but the app resolves it only because it is hoisted from
// @react-native-async-storage/async-storage — hence the LavaMoat key `...async-storage>idb`.
// An async-storage upgrade can silently swap the idb version and invalidate the policy.
// fake-indexeddb is missing at the root, so the root jest binary cannot run the IDB suites.
// Check: `yarn why idb`; run these suites via root jest after `yarn setup` → "Cannot find module".
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// Low priority — small cleanups, none blocking
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Low 1 — persistence layer lives in src/services/storage/
// ambire-common AGENTS.md: `src/services/` is for external service integrations (bundlers,
// RPC, ENS…); every other folder there is an API client. The controllers AGENTS.md recipe tells
// future controllers to copy this layout, so worth agreeing on the location now.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Low 2 — dead code and stale comments
// Unused outside tests: getOpsForAccountAndChain (interface + both adapters); removeStoredOps is
// always a no-op. Stale: getRecentOps JSDoc (cross-chain mode, `by-account-timestamp` index),
// idbSchema "Both stores below", README "both coordinators", and in storage.ts the new method
// sits between migrateNetworkPreferencesToNetworks' comment and its function.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Low 3 — RANGE_HIGH is an invisible character in the source (activityIdb.ts:24)
// `const RANGE_HIGH = '<U+FFFF>'` is typed literally; an editor or formatter can silently
// change it and break every prefix range query. One-line fix: `'\uffff'`.
// ─────────────────────────────────────────────────────────────────────────────
