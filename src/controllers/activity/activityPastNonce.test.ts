/**
 * Tests for declaring a pending account op as replaced (AccountOpStatus.UnknownButPastNonce)
 * when a confirmed op with the same EOA nonce exists.
 *
 * eoaNonce is the nonce of the EOA that paid for the broadcast (gasFeePayment.paidBy), which
 * is not always the account itself - a smart account can be paid for by any of its EOA keys.
 * Nonces of different EOAs are unrelated, so an op must only be declared replaced by a
 * confirmed op paid for by the same EOA.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { IStorageController } from '../../interfaces/storage'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { StorageController } from '../storage/storage'
import { ActivityController } from './activity'

const ACC = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
const KEY_A = '0xAbCdEf1111111111111111111111111111111111'
const KEY_B = '0x2222222222222222222222222222222222222222'
const RECIPIENT = '0x0000000000000000000000000000000000000001'
const CONFIRMED_TXN_ID = `0x${'aa'.repeat(32)}`
const PENDING_TXN_ID = `0x${'bb'.repeat(32)}`

let storage: IStorageController

beforeEach(() => {
  storage = new StorageController(produceMemoryStore())
})

afterEach(() => {
  jest.restoreAllMocks()
})

const gasFeePaymentBy = (paidBy: string) => ({
  paidBy,
  isGasTank: false,
  inToken: '0x0000000000000000000000000000000000000000',
  amount: 1n,
  simulatedGasLimit: 21000n,
  gasPrice: 1n,
  broadcastOption: 'byOtherEOA'
})

function makeOp(
  txnId: string,
  status: AccountOpStatus,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: txnId,
    accountAddr: ACC,
    chainId: 1n,
    calls: [{ to: RECIPIENT, value: 1n, data: '0x' }],
    gasFeePayment: null,
    status,
    timestamp: Date.now(),
    txnId,
    identifiedBy: { type: 'Transaction', identifier: txnId },
    ...extra
  }
}

/** A provider for which the pending txn is still in the mempool (no receipt yet). */
function makeController() {
  const provider = {
    getTransactionReceipt: jest.fn(async () => null),
    getTransaction: jest.fn(async () => ({ hash: PENDING_TXN_ID })),
    getBlock: jest.fn(async () => null)
  }

  const controller = new ActivityController(
    storage,
    (() => {}) as any,
    () => {},
    { initialLoadPromise: Promise.resolve(), accounts: [{ addr: ACC }] } as any,
    { account: { addr: ACC }, initialLoadPromise: Promise.resolve() } as any,
    { providers: { '1': provider } } as any,
    { networks: [{ chainId: 1n }] } as any,
    { addTokensToBeLearned: () => {}, addErc721sToBeLearned: () => {} } as any,
    {} as any,
    { isFeatureEnabled: () => undefined } as any, // featureFlags
    async () => {},
    undefined,
    undefined
  )

  return { controller, provider }
}

async function getPendingOpStatusAfterUpdate(
  confirmedOpExtra: Record<string, unknown>,
  pendingOpExtra: Record<string, unknown>
) {
  const { controller } = makeController()
  await controller.findMessage(ACC, () => true) // await the initial load

  await controller.addAccountOp(
    makeOp(CONFIRMED_TXN_ID, AccountOpStatus.Success, confirmedOpExtra) as any
  )
  await controller.addAccountOp(
    makeOp(PENDING_TXN_ID, AccountOpStatus.BroadcastedButNotConfirmed, pendingOpExtra) as any
  )

  await controller.updateAccountsOpsStatuses([ACC])

  return controller.findByIdentifiedBy(
    { type: 'Transaction', identifier: PENDING_TXN_ID },
    ACC,
    1n
  )?.status
}

describe('declaring a pending op replaced by a confirmed op with the same EOA nonce', () => {
  test('same nonce, same payer → replaced', async () => {
    const status = await getPendingOpStatusAfterUpdate(
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A) },
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A) }
    )

    expect(status).toBe(AccountOpStatus.UnknownButPastNonce)
  })

  test('same nonce, same payer in a different letter case → replaced', async () => {
    const status = await getPendingOpStatusAfterUpdate(
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A.toLowerCase()) },
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A) }
    )

    expect(status).toBe(AccountOpStatus.UnknownButPastNonce)
  })

  test('same nonce, different payer → still pending', async () => {
    const status = await getPendingOpStatusAfterUpdate(
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A) },
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_B) }
    )

    expect(status).toBe(AccountOpStatus.BroadcastedButNotConfirmed)
  })

  test('same payer, different nonce → still pending', async () => {
    const status = await getPendingOpStatusAfterUpdate(
      { eoaNonce: 4n, gasFeePayment: gasFeePaymentBy(KEY_A) },
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A) }
    )

    expect(status).toBe(AccountOpStatus.BroadcastedButNotConfirmed)
  })

  test('pending op without a payer → still pending (nothing to match the nonce against)', async () => {
    const status = await getPendingOpStatusAfterUpdate(
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A) },
      { eoaNonce: 5n, gasFeePayment: null }
    )

    expect(status).toBe(AccountOpStatus.BroadcastedButNotConfirmed)
  })

  test('confirmed op without a payer → still pending (its nonce owner is unknown)', async () => {
    const status = await getPendingOpStatusAfterUpdate(
      { eoaNonce: 5n, gasFeePayment: null },
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A) }
    )

    expect(status).toBe(AccountOpStatus.BroadcastedButNotConfirmed)
  })

  test('pending op without an EOA nonce (relayer / bundler broadcast) → still pending', async () => {
    const status = await getPendingOpStatusAfterUpdate(
      { eoaNonce: 5n, gasFeePayment: gasFeePaymentBy(KEY_A) },
      { gasFeePayment: gasFeePaymentBy(KEY_A) }
    )

    expect(status).toBe(AccountOpStatus.BroadcastedButNotConfirmed)
  })
})
