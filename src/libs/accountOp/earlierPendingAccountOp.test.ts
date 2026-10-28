import { describe, expect, test } from '@jest/globals'

import { ReservedNonce } from '../../utils/nonce'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { FeePaymentOption } from '../estimate/interfaces'
import { AccountOp } from './accountOp'
import {
  getEarlierPendingAccountOp,
  getEarlierPendingReplacementAccountOp
} from './earlierPendingAccountOp'
import { SubmittedAccountOp } from './submittedAccountOp'
import { AccountOpStatus } from './types'

const ACCOUNT = '0x714fD8A33a8eE16F7Fc39B3A1C4D9f3b7a7dDe5c'
const EOA = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'

const buildAccountOp = (overrides: Partial<AccountOp> = {}): AccountOp => ({
  id: 'signing-op',
  accountAddr: ACCOUNT,
  chainId: 1n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: 10n,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null,
  ...overrides
})

const buildPendingAccountOp = (
  id: string,
  overrides: Partial<SubmittedAccountOp> = {}
): SubmittedAccountOp => ({
  ...buildAccountOp({ id }),
  nonce: 8n,
  status: AccountOpStatus.BroadcastedButNotConfirmed,
  identifiedBy: { type: 'Transaction', identifier: `0x${id}` },
  timestamp: 1000,
  ...overrides
})

// Sent by the same EOA with the same EOA nonce, so they replace each other
const buildSentByEoa = (id: string, timestamp: number) =>
  buildPendingAccountOp(id, {
    eoaNonce: 5n,
    timestamp,
    gasFeePayment: {
      paidBy: EOA,
      paidByKeyType: 'internal',
      broadcastOption: BROADCAST_OPTIONS.bySelf,
      isGasTank: false,
      inToken: '0x0000000000000000000000000000000000000000',
      feeTokenChainId: 1n,
      amount: 1n,
      simulatedGasLimit: 1n,
      gasPrice: 1n,
      maxPriorityFeePerGas: 1n
    }
  })

const senderReservation = (accountOpId: string, nonce = 5n) => ({
  accountOpId,
  reserved: { kind: 'sender', addr: EOA, nonce } satisfies ReservedNonce
})
const safeReservation = (accountOpId: string, nonce: bigint) => ({
  accountOpId,
  reserved: { kind: 'account', addr: ACCOUNT, nonce } satisfies ReservedNonce
})

describe('getEarlierPendingAccountOp', () => {
  test('returns the first sent op among the ones that hold a nonce', () => {
    const result = getEarlierPendingAccountOp({
      accountOp: buildAccountOp(),
      isSafe: false,
      reservations: [senderReservation('later', 6n), senderReservation('first')],
      pendingAccountOps: [
        buildPendingAccountOp('later', { timestamp: 2000 }),
        buildPendingAccountOp('first', { timestamp: 1000 }),
        // pending, but it holds no nonce of this op, e.g. sent through a bundler
        buildPendingAccountOp('not-holding', { timestamp: 1 })
      ]
    })

    expect(result?.id).toBe('first')
  })

  test('returns null for a reservation whose op Activity does not know', () => {
    const result = getEarlierPendingAccountOp({
      accountOp: buildAccountOp(),
      isSafe: false,
      reservations: [senderReservation('unknown')],
      pendingAccountOps: []
    })

    expect(result).toBeNull()
  })

  test('ignores the op being signed once it shows up as pending', () => {
    const result = getEarlierPendingAccountOp({
      accountOp: buildAccountOp(),
      isSafe: false,
      reservations: [senderReservation('signing-op')],
      pendingAccountOps: [buildPendingAccountOp('signing-op')]
    })

    expect(result).toBeNull()
  })

  describe('replaced ops', () => {
    test('counts an op and its speed up as one, the newest', () => {
      const result = getEarlierPendingAccountOp({
        accountOp: buildAccountOp(),
        isSafe: false,
        reservations: [senderReservation('original'), senderReservation('speed-up')],
        pendingAccountOps: [buildSentByEoa('original', 1000), buildSentByEoa('speed-up', 2000)]
      })

      expect(result?.id).toBe('speed-up')
    })

    test('orders a speed up by when the op it replaces was first sent', () => {
      const speedUp = buildSentByEoa('speed-up', 3000)
      speedUp.meta = { speedUp: { enabled: true, replacedSentAt: 1000 } }
      const result = getEarlierPendingAccountOp({
        accountOp: buildAccountOp(),
        isSafe: false,
        reservations: [
          senderReservation('original'),
          senderReservation('next', 6n),
          senderReservation('speed-up')
        ],
        pendingAccountOps: [
          buildSentByEoa('original', 1000),
          // sent after the original, but before it was sped up
          buildPendingAccountOp('next', { timestamp: 2000 }),
          speedUp
        ]
      })

      expect(result?.id).toBe('speed-up')
    })
  })

  describe('Safe accounts', () => {
    test('returns the pending op with a lower Safe nonce', () => {
      const result = getEarlierPendingAccountOp({
        accountOp: buildAccountOp(),
        isSafe: true,
        reservations: [safeReservation('second', 9n), safeReservation('first', 8n)],
        pendingAccountOps: [
          buildPendingAccountOp('second', { nonce: 9n, timestamp: 1000 }),
          buildPendingAccountOp('first', { nonce: 8n, timestamp: 2000 })
        ]
      })

      // Both hold it back, so the first sent one is returned
      expect(result?.id).toBe('second')
    })

    test('ignores a pending op at or after the Safe nonce, which the user may replace on purpose', () => {
      const result = getEarlierPendingAccountOp({
        accountOp: buildAccountOp(),
        isSafe: true,
        reservations: [safeReservation('same', 10n), safeReservation('later', 11n)],
        pendingAccountOps: [
          buildPendingAccountOp('same', { nonce: 10n }),
          buildPendingAccountOp('later', { nonce: 11n })
        ]
      })

      expect(result).toBeNull()
    })

    test('is held back by a pending txn of the EOA that executes it', () => {
      const result = getEarlierPendingAccountOp({
        accountOp: buildAccountOp(),
        isSafe: true,
        reservations: [senderReservation('payer-op')],
        pendingAccountOps: [buildSentByEoa('payer-op', 1000)]
      })

      expect(result?.id).toBe('payer-op')
    })
  })
})

describe('getEarlierPendingReplacementAccountOp', () => {
  // The way the pending ops of buildSentByEoa were paid
  const feeOptions = [
    {
      paidBy: EOA,
      token: {
        address: '0x0000000000000000000000000000000000000000',
        chainId: 1n,
        flags: { onGasTank: false }
      }
    } as FeePaymentOption
  ]
  const pending = buildSentByEoa('pending', 1000)
  // A speed up of the pending op, at the same EOA nonce
  const pendingSpeedUp = buildSentByEoa('speed-up', 2000)
  // Sent after the pending op, at the next EOA nonce
  const next = { ...buildSentByEoa('next', 3000), eoaNonce: 6n }

  const getReplacement = (takesNoncesAfterReplaced: boolean) =>
    getEarlierPendingReplacementAccountOp({
      earlierPendingAccountOp: pending,
      isSafe: false,
      takesNoncesAfterReplaced,
      reservations: [
        senderReservation('pending'),
        senderReservation('speed-up'),
        senderReservation('next', 6n)
      ],
      pendingAccountOps: [pending, pendingSpeedUp, next],
      feeOptions
    })

  test('a new op sent as one txn replaces the pending op, whatever is pending after it', () => {
    expect(getReplacement(false)?.eoaNonce).toBe(5n)
  })

  test('a new op that takes nonces after the replaced one is not offered, as it would replace another pending op', () => {
    expect(getReplacement(true)).toBeNull()
  })

  test('a new op that takes nonces after the replaced one replaces the pending op when only its speed ups hold nonces', () => {
    const replacement = getEarlierPendingReplacementAccountOp({
      earlierPendingAccountOp: pending,
      isSafe: false,
      takesNoncesAfterReplaced: true,
      reservations: [senderReservation('pending'), senderReservation('speed-up')],
      pendingAccountOps: [pending, pendingSpeedUp],
      feeOptions
    })

    expect(replacement?.eoaNonce).toBe(5n)
  })
})
