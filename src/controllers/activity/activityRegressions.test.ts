/**
 * Regression tests for review findings on the IndexedDB migration of account ops (PR #2513).
 *
 * Each describe runs against both backends where it applies: the key-value run is the control,
 * the IDB run is what the migration could break. Every test here failed before its fix — the
 * comment above each block says what went wrong.
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
    calls: [{ to: RECIPIENT, value: 1n, data: '0x' }],
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
    { addTokensToBeLearned: () => {}, addErc721sToBeLearned: () => {} } as any,
    {} as any,
    { isFeatureEnabled: () => undefined } as any, // featureFlags
    async () => {},
    undefined,
    backend === 'idb' ? db : undefined
  )
}

const awaitLoad = (controller: ActivityController) => controller.findMessage(ACC_A, () => true)

// ─────────────────────────────────────────────────────────────────────────────
// Regression: in-place mutations outside updatedAccountsOps were never persisted
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

describe.each(BACKENDS)('txnId learned while pending [%s]', (backend) => {
  test('the txnId fetched from the relayer survives a service-worker restart', async () => {
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

  test('the stored txnId index knows the txnId', async () => {
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
// Regression: the duplicate guard stopped checking the in-memory ops
// #addExternalAccountOp's guard asks only the backend (hasOpWithTxnId). An internal op that is
// in memory but not yet in IDB — its txnId unsaved (see 'txnId learned while pending' above), or addOp's write still in flight
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

describe.each(BACKENDS)('external duplicate of an internal op [%s]', (backend) => {
  test('scanner reports a pending relayer op (txnId known only in memory) → no duplicate', async () => {
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

  test('scanner reports an EOA op while its addOp write is still in flight → no duplicate', async () => {
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
// Regression: txnId comparison became case-sensitive
// Pre-PR the duplicate guard compared with normalizeTxnId() (lowercase), added on purpose in
// a79a2c09b. Now IDB matches with IDBKeyRange.only(txnId) against the stored txnIds as-is, and
// the key-value adapter uses `id === txnId`. A hash that differs only in letter case (e.g. a
// relayer/indexer returning mixed-case hex) slips past the guard on BOTH backends.
// ─────────────────────────────────────────────────────────────────────────────

describe.each(BACKENDS)('txnId letter case [%s]', (backend) => {
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

  test('scanner reports a lowercase hash of an internal op stored in mixed case → no duplicate', async () => {
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
// Regression: a removed account's history was resurrected by an in-flight status poll
// updateOps() is a blind IDB put(), i.e. an upsert. If removeAccountData() runs while a status
// poll is awaiting a receipt, the poll then persists its updated op and re-creates the row the
// removal just deleted. Pre-PR the write serialized #accountsOps, which no longer held the
// account, so nothing came back.
// ─────────────────────────────────────────────────────────────────────────────

describe.each(BACKENDS)('removal racing a status poll [%s]', (backend) => {
  test('history removed mid-poll stays removed after a restart', async () => {
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
// Regression (performance): every re-filter re-read the page from IDB, even when nothing changed
// syncFilteredAccountsOps() calls filterAccountsOps() for every open session on every status
// update. Each call runs getRecentOps() per enabled chain — a one-row-per-round-trip cursor of
// (page+1)*itemsPerPage rows — plus one count() per chain, although the cache already holds
// that page. Nothing remembers how deep each group was loaded.
// ─────────────────────────────────────────────────────────────────────────────

describe('repeated page reads [idb]', () => {
  test('re-filtering an unchanged, already-loaded page does not hit IDB again', async () => {
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
