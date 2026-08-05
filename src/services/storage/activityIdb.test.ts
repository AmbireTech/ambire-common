import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { SubmittedAccountOpLike } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { ActivityIdbStorage, ActivityKeyValueStorage } from './activityIdb'
import { AmbireIdbDatabase, openAmbireIdb, resetAmbireIdbForTesting } from './idbDatabase'

// ─────────────────────────────────────────────────────────────────────────────
// Test constants
// ─────────────────────────────────────────────────────────────────────────────

const ACC_A = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const ACC_B = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const CHAIN_1 = 1n
const CHAIN_137 = 137n

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeOp(
  id: string,
  accountAddr: string,
  chainId: bigint,
  status: AccountOpStatus,
  timestamp: number
): SubmittedAccountOpLike {
  return {
    id,
    accountAddr,
    chainId,
    calls: [],
    gasFeePayment: null as any,
    status,
    timestamp,
    identifiedBy: { type: 'Transaction', identifier: `0x${id}` }
  } as SubmittedAccountOpLike
}

let db: AmbireIdbDatabase

beforeEach(async () => {
  // Reset the singleton and replace the in-memory IDB factory so each test
  // gets a completely isolated environment.
  resetAmbireIdbForTesting()
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
  // checkQuota() reads navigator.storage — stub it to avoid ReferenceError in Node.
  ;(global as any).navigator = {}
  db = await openAmbireIdb()
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ActivityIdbStorage', () => {
  describe('isEmpty', () => {
    test('returns true on a fresh store', async () => {
      const store = new ActivityIdbStorage(db)
      expect(await store.isEmpty()).toBe(true)
    })

    test('returns false after data is written', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])
      expect(await store.isEmpty()).toBe(false)
    })
  })

  describe('putOpsForAccountAndChain + getOpsForAccountAndChain', () => {
    test('stores ops and returns them sorted by timestamp descending', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000),
        makeOp('op-2', ACC_A, CHAIN_1, AccountOpStatus.Success, 3000),
        makeOp('op-3', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000)
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result?.map((op) => op.id)).toEqual(['op-2', 'op-3', 'op-1'])
    })

    test('returns undefined when no ops exist for the pair', async () => {
      const store = new ActivityIdbStorage(db)
      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)).toBeUndefined()
    })

    test('accepts bigint chainId — retrieve with bigint or equivalent string', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_137, [
        makeOp('op-1', ACC_A, CHAIN_137, AccountOpStatus.Success, 1000)
      ])

      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_137)).toHaveLength(1)
      expect(await store.getOpsForAccountAndChain(ACC_A, '137')).toHaveLength(1)
    })

    test('replaces existing ops on second write to the same pair', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('old', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('new-1', ACC_A, CHAIN_1, AccountOpStatus.Failure, 2000),
        makeOp('new-2', ACC_A, CHAIN_1, AccountOpStatus.Success, 3000)
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(2)
      expect(result?.map((op) => op.id)).not.toContain('old')
    })

    test('different chains for the same account are stored independently', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('chain1-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_137, [
        makeOp('chain137-op', ACC_A, CHAIN_137, AccountOpStatus.Success, 2000)
      ])

      expect((await store.getOpsForAccountAndChain(ACC_A, CHAIN_1))?.[0]?.id).toBe('chain1-op')
      expect((await store.getOpsForAccountAndChain(ACC_A, CHAIN_137))?.[0]?.id).toBe('chain137-op')
    })

    test('concurrent writes from different accounts to the same chain do not interfere', async () => {
      const store = new ActivityIdbStorage(db)

      await Promise.all([
        store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
          makeOp('a-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
        ]),
        store.putOpsForAccountAndChain(ACC_B, CHAIN_1, [
          makeOp('b-op', ACC_B, CHAIN_1, AccountOpStatus.Success, 2000)
        ])
      ])

      const aOps = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      const bOps = await store.getOpsForAccountAndChain(ACC_B, CHAIN_1)

      expect(aOps).toHaveLength(1)
      expect(aOps?.[0]?.id).toBe('a-op')
      expect(bOps).toHaveLength(1)
      expect(bOps?.[0]?.id).toBe('b-op')
    })

    test('writing an empty ops array leaves the pair as if it never existed', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [])
      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)).toBeUndefined()
    })

    test('silently skips ops with no valid id', async () => {
      const store = new ActivityIdbStorage(db)
      const validOp = makeOp('valid', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      const invalidOp = { ...makeOp('', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) }
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [validOp as any, invalidOp as any])
      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('valid')
    })

    test('deduplicates ops with the same id — last occurrence wins', async () => {
      const store = new ActivityIdbStorage(db)
      const v1 = makeOp('dup-id', ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, 1000)
      const v2 = makeOp('dup-id', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [v1 as any, v2 as any])
      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.status).toBe(AccountOpStatus.Success)
    })
  })

  describe('putMultiple', () => {
    test('writes all (account, chainId) pairs atomically', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putMultiple([
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('a1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1)]
        },
        {
          accountAddr: ACC_A,
          chainId: CHAIN_137,
          ops: [makeOp('a137', ACC_A, CHAIN_137, AccountOpStatus.Success, 2)]
        },
        {
          accountAddr: ACC_B,
          chainId: CHAIN_1,
          ops: [makeOp('b1', ACC_B, CHAIN_1, AccountOpStatus.Success, 3)]
        }
      ])

      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)).toHaveLength(1)
      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_137)).toHaveLength(1)
      expect(await store.getOpsForAccountAndChain(ACC_B, CHAIN_1)).toHaveLength(1)
    })

    test('replaces existing ops per pair', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putMultiple([
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('old', ACC_A, CHAIN_1, AccountOpStatus.Success, 1)]
        }
      ])
      await store.putMultiple([
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('new', ACC_A, CHAIN_1, AccountOpStatus.Success, 2)]
        }
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('new')
    })

    test('concurrent writes to the same (account, chain) pair — last writer wins', async () => {
      const store = new ActivityIdbStorage(db)

      // IDB serializes readwrite transactions — the second one starts only after
      // the first commits, so it deletes and rewrites with its own ops.
      await Promise.all([
        store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
          makeOp('writer-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
        ]),
        store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
          makeOp('writer-2', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000)
        ])
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('writer-2')
    })

    test('duplicate (account, chain) pairs in one call — last record wins silently', async () => {
      // #writeRecordToStore fires a range-delete + puts for each record in the
      // same transaction. When two records share a pair, the second range-delete
      // removes the first record's rows, leaving only the second record's ops.
      const store = new ActivityIdbStorage(db)
      await store.putMultiple([
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('first-pass', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any]
        },
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('second-pass', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) as any]
        }
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('second-pass')
    })

    test('a batch that fails mid-write commits nothing', async () => {
      // Atomicity matters most during migration: a partial commit makes IDB
      // non-empty, which permanently disables the ensureMigrated retry guard.
      const store = new ActivityIdbStorage(db)
      const good = makeOp('good', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      // Functions cannot pass through the structured clone algorithm
      const unclonable = {
        ...makeOp('unclonable', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000),
        callback: () => {}
      }

      await expect(
        store.putMultiple([
          { accountAddr: ACC_A, chainId: CHAIN_1, ops: [good as any, unclonable as any] }
        ])
      ).rejects.toThrow()

      expect(await store.isEmpty()).toBe(true)
    })

    test('an empty records array does not open a transaction', async () => {
      // db is an idb Proxy, so jest.spyOn cannot instrument it — count through a
      // thin wrapper that delegates to the real connection instead.
      let transactionCalls = 0
      const countingDb = {
        transaction: (...args: any[]) => {
          transactionCalls += 1
          return (db as any).transaction(...args)
        }
      }
      const store = new ActivityIdbStorage(countingDb as any)

      await store.putMultiple([])
      expect(transactionCalls).toBe(0)

      // A non-empty batch still opens exactly one
      await store.putMultiple([
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('x', ACC_A, CHAIN_1, AccountOpStatus.Success, 1) as any]
        }
      ])
      expect(transactionCalls).toBe(1)
    })
  })

  describe('deleteAccount', () => {
    test('removes all chains for the given account', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putMultiple([
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('a1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1)]
        },
        {
          accountAddr: ACC_A,
          chainId: CHAIN_137,
          ops: [makeOp('a137', ACC_A, CHAIN_137, AccountOpStatus.Success, 2)]
        }
      ])

      await store.deleteAccount(ACC_A)

      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)).toBeUndefined()
      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_137)).toBeUndefined()
    })

    test('does not affect other accounts', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putMultiple([
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('a', ACC_A, CHAIN_1, AccountOpStatus.Success, 1)]
        },
        {
          accountAddr: ACC_B,
          chainId: CHAIN_1,
          ops: [makeOp('b', ACC_B, CHAIN_1, AccountOpStatus.Success, 2)]
        }
      ])

      await store.deleteAccount(ACC_A)

      expect(await store.getOpsForAccountAndChain(ACC_B, CHAIN_1)).toHaveLength(1)
    })

    test('is a no-op when the account has no ops', async () => {
      const store = new ActivityIdbStorage(db)
      await expect(store.deleteAccount(ACC_A)).resolves.not.toThrow()
    })

    test('re-adding ops after deleteAccount works normally', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('original', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])
      await store.deleteAccount(ACC_A)

      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('readded', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000)
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('readded')
    })
  })

  describe('migrateFromStorage', () => {
    test('imports all ops from InternalAccountsOps format', async () => {
      const store = new ActivityIdbStorage(db)
      await store.migrateFromStorage({
        [ACC_A]: {
          '1': [makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any],
          '137': [makeOp('op-2', ACC_A, CHAIN_137, AccountOpStatus.Failure, 2000) as any]
        },
        [ACC_B]: {
          '1': [makeOp('op-3', ACC_B, CHAIN_1, AccountOpStatus.Success, 3000) as any]
        }
      })

      expect(await store.getOpsForAccountAndChain(ACC_A, '1')).toHaveLength(1)
      expect(await store.getOpsForAccountAndChain(ACC_A, '137')).toHaveLength(1)
      expect(await store.getOpsForAccountAndChain(ACC_B, '1')).toHaveLength(1)
    })

    test('preserves op ids and timestamps after migration', async () => {
      const store = new ActivityIdbStorage(db)
      await store.migrateFromStorage({
        [ACC_A]: {
          '1': [makeOp('migrate-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 42000) as any]
        }
      })

      const result = await store.getOpsForAccountAndChain(ACC_A, '1')
      expect(result?.[0]?.id).toBe('migrate-op')
      expect(result?.[0]?.timestamp).toBe(42000)
    })

    test('migrating an empty {} object writes nothing and leaves the store empty', async () => {
      const store = new ActivityIdbStorage(db)
      await store.migrateFromStorage({})
      expect(await store.isEmpty()).toBe(true)
    })
  })

  describe('ensureMigrated', () => {
    test('migrates when IDB is empty and storage has ops', async () => {
      const store = new ActivityIdbStorage(db)
      const legacy = {
        [ACC_A]: {
          '1': [makeOp('legacy-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any]
        }
      }

      await store.ensureMigrated(
        async () => legacy,
        async () => {}
      )

      expect(await store.getOpsForAccountAndChain(ACC_A, '1')).toHaveLength(1)
    })

    test('calls removeStoredOps after a successful migration', async () => {
      const store = new ActivityIdbStorage(db)
      const removeSpy = jest.fn(async () => {})

      await store.ensureMigrated(
        async () => ({
          [ACC_A]: {
            '1': [makeOp('op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any]
          }
        }),
        removeSpy
      )

      expect(removeSpy).toHaveBeenCalledTimes(1)
    })

    test('skips migration when IDB already has data', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('existing', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])

      const getStoredSpy = jest.fn(async () => ({}))
      await store.ensureMigrated(getStoredSpy, async () => {})

      expect(getStoredSpy).not.toHaveBeenCalled()
    })

    test('a legacy op missing timestamp is dropped — the rest of the history still migrates', async () => {
      // Regression: #opToRow used to throw mid-batch on such a row. The ops queued
      // before it still committed, so IDB became non-empty, the isEmpty() guard
      // skipped every future retry, and everything after the bad row was stranded
      // in the legacy key forever. Unusable rows are now filtered out up front.
      const store = new ActivityIdbStorage(db)
      const legacy: any = {
        [ACC_A]: {
          '1': [
            makeOp('good-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000),
            { id: 'no-timestamp', accountAddr: ACC_A, chainId: CHAIN_1, status: 'success' },
            makeOp('good-2', ACC_A, CHAIN_1, AccountOpStatus.Success, 3000)
          ]
        }
      }
      const removeSpy = jest.fn(async () => {})

      await store.ensureMigrated(async () => legacy, removeSpy)

      const ids = (await store.getOpsForAccountAndChain(ACC_A, '1'))?.map((op) => op.id)
      expect(ids).toEqual(['good-2', 'good-1'])
      expect(ids).not.toContain('no-timestamp')
      // Migration completed, so the legacy key is cleaned up rather than retried
      expect(removeSpy).toHaveBeenCalledTimes(1)
    })

    test('a legacy op missing status is dropped without failing the batch', async () => {
      const store = new ActivityIdbStorage(db)
      const legacy: any = {
        [ACC_A]: {
          '1': [
            { id: 'no-status', accountAddr: ACC_A, chainId: CHAIN_1, timestamp: 500 },
            makeOp('good', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
          ]
        }
      }

      await store.ensureMigrated(
        async () => legacy,
        async () => {}
      )

      const ids = (await store.getOpsForAccountAndChain(ACC_A, '1'))?.map((op) => op.id)
      expect(ids).toEqual(['good'])
    })

    test('concurrent ensureMigrated calls converge on the same migrated data', async () => {
      const store1 = new ActivityIdbStorage(db)
      const store2 = new ActivityIdbStorage(db)
      const legacy = {
        [ACC_A]: {
          '1': [makeOp('concurrent', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any]
        }
      }

      // Both see isEmpty()=true before either writes; the second put is idempotent
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

      const ops = await store1.getOpsForAccountAndChain(ACC_A, '1')
      expect(ops).toHaveLength(1)
      expect(ops?.[0]?.id).toBe('concurrent')
    })

    test('skips migration when storage returns an empty object', async () => {
      const store = new ActivityIdbStorage(db)
      const removeSpy = jest.fn(async () => {})

      await store.ensureMigrated(async () => ({}), removeSpy)

      expect(await store.isEmpty()).toBe(true)
      expect(removeSpy).not.toHaveBeenCalled()
    })

    test('is idempotent — calling twice preserves the first migration result', async () => {
      const store = new ActivityIdbStorage(db)
      const legacy = {
        [ACC_A]: {
          '1': [makeOp('migrated', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any]
        }
      }

      await store.ensureMigrated(
        async () => legacy,
        async () => {}
      )
      // Second call: IDB is non-empty — must not overwrite with stale data
      await store.ensureMigrated(
        async () => ({
          [ACC_A]: { '1': [makeOp('stale', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) as any] }
        }),
        async () => {}
      )

      const ops = await store.getOpsForAccountAndChain(ACC_A, '1')
      expect(ops).toHaveLength(1)
      expect(ops?.[0]?.id).toBe('migrated')
    })

    test('error from getStoredOps propagates and leaves IDB unchanged', async () => {
      const store = new ActivityIdbStorage(db)

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

    test('error from removeStoredOps propagates after IDB was already written', async () => {
      const store = new ActivityIdbStorage(db)
      const legacy = {
        [ACC_A]: {
          '1': [makeOp('legacy-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any]
        }
      }

      await expect(
        store.ensureMigrated(
          async () => legacy,
          async () => {
            throw new Error('remove failed')
          }
        )
      ).rejects.toThrow('remove failed')

      // IDB was written before removeStoredOps was called
      expect(await store.isEmpty()).toBe(false)
      expect(await store.getOpsForAccountAndChain(ACC_A, '1')).toHaveLength(1)
    })
  })

  describe('loadStartupOps', () => {
    test('returns an empty object for an empty store', async () => {
      const store = new ActivityIdbStorage(db)
      expect(await store.loadStartupOps()).toEqual({})
    })

    test('returns all pending ops regardless of how many there are', async () => {
      const store = new ActivityIdbStorage(db)
      // 25 pending — more than the 20-op finalized limit
      const ops = Array.from({ length: 25 }, (_, i) =>
        makeOp(`op-${i}`, ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, i * 100)
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, ops)

      const result = await store.loadStartupOps()
      expect(result[ACC_A]?.['1']).toHaveLength(25)
    })

    test('limits finalized ops to 20 per (account, chainId) group', async () => {
      const store = new ActivityIdbStorage(db)
      const ops = Array.from({ length: 25 }, (_, i) =>
        makeOp(`op-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Success, i * 100)
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, ops)

      const result = await store.loadStartupOps()
      expect(result[ACC_A]?.['1']).toHaveLength(20)
    })

    test('always includes pending ops even when the finalized limit is already reached', async () => {
      const store = new ActivityIdbStorage(db)
      const finalized = Array.from({ length: 20 }, (_, i) =>
        makeOp(`fin-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Success, i * 10)
      )
      const pending = Array.from({ length: 3 }, (_, i) =>
        makeOp(`pend-${i}`, ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, 1000 + i)
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [...finalized, ...pending])

      const result = await store.loadStartupOps()
      const ids = (result[ACC_A]?.['1'] ?? []).map((op) => op.id)
      expect(ids.filter((id) => id.startsWith('pend-'))).toHaveLength(3)
      expect(ids.filter((id) => id.startsWith('fin-'))).toHaveLength(20)
    })

    test('returns ops sorted by timestamp descending within each group', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 100),
        makeOp('op-2', ACC_A, CHAIN_1, AccountOpStatus.Success, 300),
        makeOp('op-3', ACC_A, CHAIN_1, AccountOpStatus.Success, 200)
      ])

      const result = await store.loadStartupOps()
      expect((result[ACC_A]?.['1'] ?? []).map((op) => op.timestamp)).toEqual([300, 200, 100])
    })

    test('handles multiple accounts and chains independently', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putMultiple([
        {
          accountAddr: ACC_A,
          chainId: CHAIN_1,
          ops: [makeOp('a1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1)]
        },
        {
          accountAddr: ACC_A,
          chainId: CHAIN_137,
          ops: [makeOp('a137', ACC_A, CHAIN_137, AccountOpStatus.Success, 2)]
        },
        {
          accountAddr: ACC_B,
          chainId: CHAIN_1,
          ops: [makeOp('b1', ACC_B, CHAIN_1, AccountOpStatus.Success, 3)]
        }
      ])

      const result = await store.loadStartupOps()
      expect(result[ACC_A]?.['1']).toHaveLength(1)
      expect(result[ACC_A]?.['137']).toHaveLength(1)
      expect(result[ACC_B]?.['1']).toHaveLength(1)
    })

    test('selects the 20 newest finalized ops (highest timestamps) per group', async () => {
      const store = new ActivityIdbStorage(db)
      // ops 0-24 — op with index 24 has the highest timestamp
      const ops = Array.from({ length: 25 }, (_, i) =>
        makeOp(`op-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Success, i * 100)
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, ops)

      const result = await store.loadStartupOps()
      const timestamps = (result[ACC_A]?.['1'] ?? []).map((op) => op.timestamp)
      // Expect 2400, 2300, ..., 500 (the 20 newest)
      expect(Math.min(...timestamps)).toBe(500)
      expect(Math.max(...timestamps)).toBe(2400)
    })

    test('20-op finalized cap applies independently to each (account, chain) pair', async () => {
      const store = new ActivityIdbStorage(db)
      const make25 = (prefix: string, addr: string, chain: bigint) =>
        Array.from({ length: 25 }, (_, i) =>
          makeOp(`${prefix}-${i}`, addr, chain, AccountOpStatus.Success, i * 100)
        )

      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, make25('a1', ACC_A, CHAIN_1))
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_137, make25('a137', ACC_A, CHAIN_137))

      const result = await store.loadStartupOps()
      expect(result[ACC_A]?.['1']).toHaveLength(20)
      expect(result[ACC_A]?.['137']).toHaveLength(20)
    })

    test('treats AccountOpStatus.Pending as pending — not subject to the finalized cap', async () => {
      const store = new ActivityIdbStorage(db)
      const finalized = Array.from({ length: 20 }, (_, i) =>
        makeOp(`fin-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Success, i * 10)
      )
      // Queued ops (status=Pending) must also be returned uncapped, same as BroadcastedButNotConfirmed
      const queued = Array.from({ length: 5 }, (_, i) =>
        makeOp(`queued-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Pending, 1000 + i)
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [...finalized, ...queued] as any[])

      const result = await store.loadStartupOps()
      const ids = (result[ACC_A]?.['1'] ?? []).map((op) => op.id)
      expect(ids.filter((id) => id.startsWith('queued-'))).toHaveLength(5)
      expect(ids.filter((id) => id.startsWith('fin-'))).toHaveLength(20)
    })

    test('collects both BroadcastedButNotConfirmed and Pending via separate index queries', async () => {
      // loadStartupOps fires two getAll() calls per group — one per pending status.
      // A mix of both types in the same group verifies neither query is broken.
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('fin-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 100) as any,
        makeOp('bcast-1', ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, 200) as any,
        makeOp('bcast-2', ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, 300) as any,
        makeOp('pend-1', ACC_A, CHAIN_1, AccountOpStatus.Pending, 400) as any,
        makeOp('pend-2', ACC_A, CHAIN_1, AccountOpStatus.Pending, 500) as any
      ] as any[])

      const result = await store.loadStartupOps()
      const ids = (result[ACC_A]?.['1'] ?? []).map((op) => op.id)
      expect(ids).toHaveLength(5)
      expect(ids).toContain('fin-1')
      expect(ids).toContain('bcast-1')
      expect(ids).toContain('bcast-2')
      expect(ids).toContain('pend-1')
      expect(ids).toContain('pend-2')
    })
  })

  describe('bigint serialization roundtrip', () => {
    test('chainId and nonce survive serialize → store → deserialize', async () => {
      const store = new ActivityIdbStorage(db)
      const op = {
        id: 'bigint-op',
        accountAddr: ACC_A,
        chainId: CHAIN_1,
        nonce: 42n,
        calls: [],
        gasFeePayment: null,
        status: AccountOpStatus.Success,
        timestamp: 1000,
        identifiedBy: { type: 'Transaction', identifier: '0xhash' }
      } as unknown as SubmittedAccountOpLike

      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [op])
      const [retrieved] = (await store.getOpsForAccountAndChain(ACC_A, CHAIN_1))!

      expect(retrieved?.chainId).toBe(CHAIN_1)
      expect((retrieved as any).nonce).toBe(42n)
    })
  })

  describe('putSingleOp', () => {
    test('adds a new op accessible via getOpsForAccountAndChain', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putSingleOp(
        ACC_A,
        CHAIN_1,
        makeOp('single-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
      )
      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('single-op')
    })

    test('evicts the op identified by trimmedId', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('old-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
      ])
      await store.putSingleOp(
        ACC_A,
        CHAIN_1,
        makeOp('new-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) as any,
        'old-op'
      )
      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('new-op')
    })

    test('trimmedId that does not exist in IDB — no error, new op is still added', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putSingleOp(
        ACC_A,
        CHAIN_1,
        makeOp('added-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any,
        'ghost-id'
      )
      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('added-op')
    })

    test('coexists with ops written by putOpsForAccountAndChain', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('bulk-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
      ])
      await store.putSingleOp(
        ACC_A,
        CHAIN_1,
        makeOp('single-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) as any
      )
      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(2)
      expect(result!.map((op) => op.id)).toContain('bulk-op')
      expect(result!.map((op) => op.id)).toContain('single-op')
    })

    test('throws when op has no valid id', async () => {
      const store = new ActivityIdbStorage(db)
      await expect(
        store.putSingleOp(
          ACC_A,
          CHAIN_1,
          makeOp('', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
        )
      ).rejects.toThrow('Cannot store op without a valid id')
    })

    test('throws when op has no timestamp', async () => {
      const store = new ActivityIdbStorage(db)
      const invalid = {
        ...makeOp('op-no-ts', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000),
        timestamp: undefined
      }
      await expect(store.putSingleOp(ACC_A, CHAIN_1, invalid as any)).rejects.toThrow(
        'without a valid timestamp'
      )
    })

    test('evicts the oldest op when the group exceeds MAX_IDB_GROUP_SIZE (1000)', async () => {
      const store = new ActivityIdbStorage(db)
      // Fill to exactly 1000 ops (timestamps 0..999, oldest id is 'cap-op-0')
      const ops = Array.from(
        { length: 1000 },
        (_, i) => makeOp(`cap-op-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Success, i) as any
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, ops)

      // Adding one more without trimmedId should trigger eviction of the oldest
      await store.putSingleOp(
        ACC_A,
        CHAIN_1,
        makeOp('cap-op-1000', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
      )

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1000)
      expect(result!.map((op) => op.id)).not.toContain('cap-op-0')
      expect(result!.map((op) => op.id)).toContain('cap-op-1000')
    })
  })

  describe('updateOps', () => {
    test('updates the status of an existing op', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('update-me', ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, 1000) as any
      ])

      await store.updateOps([
        makeOp('update-me', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.status).toBe(AccountOpStatus.Success)
    })

    test('creates a new row when the op does not exist in IDB', async () => {
      const store = new ActivityIdbStorage(db)
      await store.updateOps([
        makeOp('new-via-update', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) as any
      ])
      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result).toHaveLength(1)
      expect(result?.[0]?.id).toBe('new-via-update')
    })

    test('empty array is a no-op — store is unchanged', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('existing', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
      ])
      await store.updateOps([])
      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)).toHaveLength(1)
    })

    test('updates multiple ops in a single call', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('op-a', ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, 1000) as any,
        makeOp('op-b', ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, 2000) as any
      ])

      await store.updateOps([
        makeOp('op-a', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any,
        makeOp('op-b', ACC_A, CHAIN_1, AccountOpStatus.Failure, 2000) as any
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      const statusById = Object.fromEntries(result!.map((op) => [op.id, op.status]))
      expect(statusById['op-a']).toBe(AccountOpStatus.Success)
      expect(statusById['op-b']).toBe(AccountOpStatus.Failure)
    })
  })

  // The connection handle is captured at construction but can die later —
  // blocking() closes it for an upgrade, and the browser can terminate it under
  // storage pressure. The database survives, so a reopen recovers fully.
  describe('recovery from a closed connection', () => {
    // These deliberately use the PRODUCTION reconnect (the constructor default,
    // openAmbireIdb) rather than a helper that resets the singleton first. An
    // earlier version of these tests pre-reset it, which hid a real bug: on a close
    // that fires neither blocking() nor terminated(), the cached promise still
    // resolves to the dead connection, so recovery failed in production while the
    // tests passed.
    test('a write after the connection closes reopens and succeeds', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putSingleOp(
        ACC_A,
        CHAIN_1,
        makeOp('before', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
      )

      db.close()

      await store.putSingleOp(
        ACC_A,
        CHAIN_1,
        makeOp('after', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) as any
      )

      // Both rows are present, so the op written after the close was not lost
      const ids = (await store.getOpsForAccountAndChain(ACC_A, CHAIN_1))?.map((op) => op.id)
      expect(ids).toEqual(['after', 'before'])
    })

    test('a read after the connection closes reopens and returns the data', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('persisted', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])

      db.close()

      expect((await store.getOpsForAccountAndChain(ACC_A, CHAIN_1))?.[0]?.id).toBe('persisted')
      expect(await store.isEmpty()).toBe(false)
    })

    test('loadStartupOps recovers from a closed connection', async () => {
      const store = new ActivityIdbStorage(db)
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('startup', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])

      db.close()

      const result = await store.loadStartupOps()
      expect(result[ACC_A]?.['1']).toHaveLength(1)
    })

    test('errors unrelated to a dead connection are not retried', async () => {
      // The only test here that injects a reconnect, so it can assert it is never
      // reached. The rest deliberately use the production default.
      const reconnect = jest.fn(openAmbireIdb)
      const store = new ActivityIdbStorage(db, reconnect)

      // A validation failure must surface as-is rather than triggering a reopen
      await expect(
        store.putSingleOp(
          ACC_A,
          CHAIN_1,
          makeOp('', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any
        )
      ).rejects.toThrow('without a valid id')

      expect(reconnect).not.toHaveBeenCalled()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ActivityKeyValueStorage
// ─────────────────────────────────────────────────────────────────────────────

describe('ActivityKeyValueStorage', () => {
  function makeStorageMock(initial: Record<string, any> = {}) {
    const store: Record<string, any> = { ...initial }
    return {
      get: jest.fn(async (key: string, defaultValue: any) =>
        key in store ? structuredClone(store[key]) : defaultValue
      ),
      set: jest.fn(async (key: string, value: any) => {
        store[key] = structuredClone(value)
      })
    }
  }

  test('loadStartupOps returns {} when storage is empty', async () => {
    const backend = new ActivityKeyValueStorage(makeStorageMock() as any, () => ({}))
    expect(await backend.loadStartupOps()).toEqual({})
  })

  test('loadStartupOps returns the stored ops blob', async () => {
    const stored = {
      [ACC_A]: { '1': [makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any] }
    }
    const backend = new ActivityKeyValueStorage(
      makeStorageMock({ accountsOps: stored }) as any,
      () => ({})
    )
    const result = await backend.loadStartupOps()
    expect(result[ACC_A]?.['1']).toHaveLength(1)
  })

  test('every write method persists the current getOps() snapshot to storage', async () => {
    const inMemoryOps = {
      [ACC_A]: { '1': [makeOp('op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any] }
    }
    const storage = makeStorageMock()
    const backend = new ActivityKeyValueStorage(storage as any, () => inMemoryOps)

    await backend.putOpsForAccountAndChain(ACC_A, CHAIN_1, [])
    expect(storage.set).toHaveBeenCalledWith('accountsOps', inMemoryOps)
    storage.set.mockClear()

    await backend.putMultiple([])
    expect(storage.set).toHaveBeenCalledWith('accountsOps', inMemoryOps)
    storage.set.mockClear()

    await backend.deleteAccount(ACC_A)
    expect(storage.set).toHaveBeenCalledWith('accountsOps', inMemoryOps)
    storage.set.mockClear()

    await backend.updateOps([])
    expect(storage.set).toHaveBeenCalledWith('accountsOps', inMemoryOps)
    storage.set.mockClear()

    await backend.putSingleOp(
      ACC_A,
      CHAIN_1,
      makeOp('new', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) as any
    )
    expect(storage.set).toHaveBeenCalledWith('accountsOps', inMemoryOps)
  })

  test('getOpsForAccountAndChain reads in-memory state sorted by timestamp descending', async () => {
    const inMemoryOps = {
      [ACC_A]: {
        '1': [
          makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000) as any,
          makeOp('op-2', ACC_A, CHAIN_1, AccountOpStatus.Success, 3000) as any,
          makeOp('op-3', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000) as any
        ]
      }
    }
    const storage = makeStorageMock()
    const backend = new ActivityKeyValueStorage(storage as any, () => inMemoryOps)

    const result = await backend.getOpsForAccountAndChain(ACC_A, CHAIN_1)
    expect(result?.map((op) => op.id)).toEqual(['op-2', 'op-3', 'op-1'])
    // Must read in-memory state — storage.get must not be called
    expect(storage.get).not.toHaveBeenCalled()
  })

  test('getOpsForAccountAndChain returns undefined for an unknown account or chain', async () => {
    const backend = new ActivityKeyValueStorage(makeStorageMock() as any, () => ({}))
    expect(await backend.getOpsForAccountAndChain(ACC_A, CHAIN_1)).toBeUndefined()
  })

  test('ensureMigrated is a no-op — neither callback is called', async () => {
    const backend = new ActivityKeyValueStorage(makeStorageMock() as any, () => ({}))
    const getOpsSpy = jest.fn(async () => ({}))
    const removeSpy = jest.fn(async () => {})

    await backend.ensureMigrated(getOpsSpy, removeSpy)

    expect(getOpsSpy).not.toHaveBeenCalled()
    expect(removeSpy).not.toHaveBeenCalled()
  })
})
