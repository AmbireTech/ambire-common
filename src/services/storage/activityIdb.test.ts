import 'fake-indexeddb/auto'

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from '@jest/globals'

import { SubmittedAccountOpLike } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { ActivityIdbStorage } from './activityIdb'
import { BaseIdbStore } from './baseIdbStore'

// ─────────────────────────────────────────────────────────────────────────────
// Test constants
// ─────────────────────────────────────────────────────────────────────────────

const ACC_A = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const ACC_B = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
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

beforeEach(() => {
  // Reset the shared DB connection so each test gets a completely isolated environment.
  BaseIdbStore.resetDb('ambire')
  global.indexedDB = new IDBFactory()
  global.IDBKeyRange = IDBKeyRange
  // checkQuota() reads navigator.storage — stub it to avoid ReferenceError in Node.
  ;(global as any).navigator = {}
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ActivityIdbStorage', () => {
  describe('isEmpty', () => {
    test('returns true on a fresh store', async () => {
      const store = new ActivityIdbStorage()
      expect(await store.isEmpty()).toBe(true)
    })

    test('returns false after data is written', async () => {
      const store = new ActivityIdbStorage()
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])
      expect(await store.isEmpty()).toBe(false)
    })
  })

  describe('putOpsForAccountAndChain + getOpsForAccountAndChain', () => {
    test('stores ops and returns them sorted by timestamp descending', async () => {
      const store = new ActivityIdbStorage()
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000),
        makeOp('op-2', ACC_A, CHAIN_1, AccountOpStatus.Success, 3000),
        makeOp('op-3', ACC_A, CHAIN_1, AccountOpStatus.Success, 2000)
      ])

      const result = await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)
      expect(result?.map((op) => op.id)).toEqual(['op-2', 'op-3', 'op-1'])
    })

    test('returns undefined when no ops exist for the pair', async () => {
      const store = new ActivityIdbStorage()
      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_1)).toBeUndefined()
    })

    test('accepts bigint chainId — retrieve with bigint or equivalent string', async () => {
      const store = new ActivityIdbStorage()
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_137, [
        makeOp('op-1', ACC_A, CHAIN_137, AccountOpStatus.Success, 1000)
      ])

      expect(await store.getOpsForAccountAndChain(ACC_A, CHAIN_137)).toHaveLength(1)
      expect(await store.getOpsForAccountAndChain(ACC_A, '137')).toHaveLength(1)
    })

    test('replaces existing ops on second write to the same pair', async () => {
      const store = new ActivityIdbStorage()
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
      const store = new ActivityIdbStorage()
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('chain1-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 1000)
      ])
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_137, [
        makeOp('chain137-op', ACC_A, CHAIN_137, AccountOpStatus.Success, 2000)
      ])

      expect((await store.getOpsForAccountAndChain(ACC_A, CHAIN_1))![0].id).toBe('chain1-op')
      expect((await store.getOpsForAccountAndChain(ACC_A, CHAIN_137))![0].id).toBe('chain137-op')
    })
  })

  describe('putMultiple', () => {
    test('writes all (account, chainId) pairs atomically', async () => {
      const store = new ActivityIdbStorage()
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
      const store = new ActivityIdbStorage()
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
      expect(result![0].id).toBe('new')
    })
  })

  describe('deleteAccount', () => {
    test('removes all chains for the given account', async () => {
      const store = new ActivityIdbStorage()
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
      const store = new ActivityIdbStorage()
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
      const store = new ActivityIdbStorage()
      await expect(store.deleteAccount(ACC_A)).resolves.not.toThrow()
    })
  })

  describe('migrateFromStorage', () => {
    test('imports all ops from InternalAccountsOps format', async () => {
      const store = new ActivityIdbStorage()
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
      const store = new ActivityIdbStorage()
      await store.migrateFromStorage({
        [ACC_A]: {
          '1': [makeOp('migrate-op', ACC_A, CHAIN_1, AccountOpStatus.Success, 42000) as any]
        }
      })

      const result = await store.getOpsForAccountAndChain(ACC_A, '1')
      expect(result![0].id).toBe('migrate-op')
      expect(result![0].timestamp).toBe(42000)
    })
  })

  describe('loadStartupOps', () => {
    test('returns an empty object for an empty store', async () => {
      const store = new ActivityIdbStorage()
      expect(await store.loadStartupOps()).toEqual({})
    })

    test('returns all pending ops regardless of how many there are', async () => {
      const store = new ActivityIdbStorage()
      // 25 pending — more than the 20-op finalized limit
      const ops = Array.from({ length: 25 }, (_, i) =>
        makeOp(`op-${i}`, ACC_A, CHAIN_1, AccountOpStatus.BroadcastedButNotConfirmed, i * 100)
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, ops)

      const result = await store.loadStartupOps()
      expect(result[ACC_A]?.['1']).toHaveLength(25)
    })

    test('limits finalized ops to 20 per (account, chainId) group', async () => {
      const store = new ActivityIdbStorage()
      const ops = Array.from({ length: 25 }, (_, i) =>
        makeOp(`op-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Success, i * 100)
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, ops)

      const result = await store.loadStartupOps()
      expect(result[ACC_A]?.['1']).toHaveLength(20)
    })

    test('always includes pending ops even when the finalized limit is already reached', async () => {
      const store = new ActivityIdbStorage()
      const finalized = Array.from({ length: 20 }, (_, i) =>
        makeOp(`fin-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Success, i * 10)
      )
      const pending = Array.from({ length: 3 }, (_, i) =>
        makeOp(
          `pend-${i}`,
          ACC_A,
          CHAIN_1,
          AccountOpStatus.BroadcastedButNotConfirmed,
          1000 + i
        )
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [...finalized, ...pending])

      const result = await store.loadStartupOps()
      const ids = result[ACC_A]!['1'].map((op) => op.id)
      expect(ids.filter((id) => id.startsWith('pend-'))).toHaveLength(3)
      expect(ids.filter((id) => id.startsWith('fin-'))).toHaveLength(20)
    })

    test('returns ops sorted by timestamp descending within each group', async () => {
      const store = new ActivityIdbStorage()
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, [
        makeOp('op-1', ACC_A, CHAIN_1, AccountOpStatus.Success, 100),
        makeOp('op-2', ACC_A, CHAIN_1, AccountOpStatus.Success, 300),
        makeOp('op-3', ACC_A, CHAIN_1, AccountOpStatus.Success, 200)
      ])

      const result = await store.loadStartupOps()
      expect(result[ACC_A]!['1'].map((op) => op.timestamp)).toEqual([300, 200, 100])
    })

    test('handles multiple accounts and chains independently', async () => {
      const store = new ActivityIdbStorage()
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
      const store = new ActivityIdbStorage()
      // ops 0-24 — op with index 24 has the highest timestamp
      const ops = Array.from({ length: 25 }, (_, i) =>
        makeOp(`op-${i}`, ACC_A, CHAIN_1, AccountOpStatus.Success, i * 100)
      )
      await store.putOpsForAccountAndChain(ACC_A, CHAIN_1, ops)

      const result = await store.loadStartupOps()
      const timestamps = result[ACC_A]!['1'].map((op) => op.timestamp)
      // Expect 2400, 2300, ..., 500 (the 20 newest)
      expect(Math.min(...timestamps)).toBe(500)
      expect(Math.max(...timestamps)).toBe(2400)
    })
  })

  describe('bigint serialization roundtrip', () => {
    test('chainId and nonce survive serialize → store → deserialize', async () => {
      const store = new ActivityIdbStorage()
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

      expect(retrieved.chainId).toBe(CHAIN_1)
      expect((retrieved as any).nonce).toBe(42n)
    })
  })

})
