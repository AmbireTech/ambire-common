import { ethers, ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { AccountOp, GasFeePayment, isSafeRejectionCall } from './accountOp'
import { getCancelledNonce, hasCancelCalls, isCancelAccountOp, toCancelAccountOp } from './cancel'
import { Call } from './types'

describe('toCancelAccountOp', () => {
  const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
  const recipient = '0xc4ce03b36f057591b2a360d773edb9896255051e'
  const gasFeePayment: GasFeePayment = {
    isGasTank: false,
    paidBy: accountAddr,
    paidByKeyType: 'internal',
    inToken: ZeroAddress,
    amount: 1000n,
    simulatedGasLimit: 21000n,
    gasPrice: 10n,
    broadcastOption: BROADCAST_OPTIONS.bySelf
  }
  const pendingOp = (overrides: Partial<AccountOp> = {}): AccountOp => ({
    id: 'pending',
    accountAddr,
    chainId: 1n,
    signingKeyAddr: accountAddr,
    signingKeyType: 'internal',
    nonce: 7n,
    eoaNonce: 12n,
    calls: [{ id: 'send', to: recipient, value: ethers.parseEther('1'), data: '0x' }],
    feeCall: { to: recipient, value: 0n, data: '0x01' },
    activatorCall: { to: recipient, value: 0n, data: '0x02' },
    gasLimit: 50000,
    signature: '0xsignature',
    signed: [accountAddr],
    txnId: '0xtxn',
    gasFeePayment,
    meta: {
      setDelegation: true,
      topUpAmount: 1n,
      speedUp: {
        enabled: true,
        isCancel: true,
        replacedSentAt: 1,
        replacedIdentifiedBy: { type: 'Transaction', identifier: '0xtxn' }
      }
    },
    ...overrides
  })
  const isEmptyCall = (call: Call) =>
    call.to === ZeroAddress && call.value === 0n && call.data === '0x'

  test('replaces the calls with a single empty call', () => {
    const cancelOp = toCancelAccountOp(pendingOp())

    expect(cancelOp.calls).toHaveLength(1)
    expect(cancelOp.calls.every(isEmptyCall)).toBe(true)
  })

  test('keeps the nonces and the fee payment, so it replaces the pending transaction', () => {
    const cancelOp = toCancelAccountOp(pendingOp())

    expect(cancelOp.nonce).toBe(7n)
    expect(cancelOp.eoaNonce).toBe(12n)
    expect(cancelOp.gasFeePayment).toEqual(gasFeePayment)
    expect(cancelOp.accountAddr).toBe(accountAddr)
    expect(cancelOp.chainId).toBe(1n)
  })

  test('drops the signing key, so the cancel picks its signer like a new transaction', () => {
    const cancelOp = toCancelAccountOp(pendingOp())

    expect(cancelOp.signingKeyAddr).toBeNull()
    expect(cancelOp.signingKeyType).toBeNull()
  })

  test('keeps the key that pays the fee, as the same account must send the replacement', () => {
    const cancelOp = toCancelAccountOp(pendingOp())

    expect(cancelOp.gasFeePayment?.paidBy).toBe(accountAddr)
    expect(cancelOp.gasFeePayment?.paidByKeyType).toBe('internal')
  })

  test('drops what was made for the replaced calls', () => {
    const cancelOp = toCancelAccountOp(pendingOp())

    expect(cancelOp.signature).toBeNull()
    expect(cancelOp.signed).toEqual([])
    expect(cancelOp.txnId).toBeUndefined()
    expect(cancelOp.safeTx).toBeUndefined()
    expect(cancelOp.feeCall).toBeUndefined()
    expect(cancelOp.activatorCall).toBeUndefined()
    expect(cancelOp.asUserOperation).toBeUndefined()
    expect(cancelOp.gasLimit).toBeNull()
  })

  test('keeps only the speed up meta, so a delegation or top up does not run with it', () => {
    const cancelOp = toCancelAccountOp(pendingOp())

    expect(cancelOp.meta).toEqual({
      speedUp: {
        enabled: true,
        isCancel: true,
        replacedSentAt: 1,
        replacedIdentifiedBy: { type: 'Transaction', identifier: '0xtxn' },
        replacedNonce: 7n
      }
    })
  })

  test('remembers the account nonce of the pending transaction', () => {
    expect(toCancelAccountOp(pendingOp()).meta?.speedUp?.replacedNonce).toBe(7n)
  })

  test('building the same cancel again keeps the remembered nonce, not the current one', () => {
    const cancelOp = toCancelAccountOp(pendingOp())
    const builtAgain = toCancelAccountOp({ ...cancelOp, nonce: 8n })

    expect(builtAgain.meta?.speedUp?.replacedNonce).toBe(7n)
  })

  test('takes the place of every transaction of a batch broadcast as one per call', () => {
    const cancelOp = toCancelAccountOp(
      pendingOp({
        calls: [
          { id: 'a', to: recipient, value: 1n, data: '0x' },
          { id: 'b', to: recipient, value: 0n, data: '0xabcdef' },
          { id: 'c', to: recipient, value: 2n, data: '0x' }
        ],
        meta: {
          speedUp: {
            enabled: true,
            isCancel: true,
            replacedIdentifiedBy: { type: 'MultipleTxns', identifier: '0xa-0xb-0xc' }
          }
        }
      })
    )

    expect(cancelOp.calls).toHaveLength(3)
    expect(cancelOp.calls.every(isEmptyCall)).toBe(true)
  })

  test('a batch broadcast as one transaction gets a single empty call', () => {
    const cancelOp = toCancelAccountOp(
      pendingOp({
        calls: [
          { id: 'a', to: recipient, value: 1n, data: '0x' },
          { id: 'b', to: recipient, value: 0n, data: '0xabcdef' }
        ]
      })
    )

    expect(cancelOp.calls).toHaveLength(1)
    expect(cancelOp.calls.every(isEmptyCall)).toBe(true)
  })

  test('marks it as a cancel even if only the speed up was enabled', () => {
    const cancelOp = toCancelAccountOp(pendingOp({ meta: { speedUp: { enabled: true } } }))

    expect(cancelOp.meta?.speedUp?.enabled).toBe(true)
    expect(cancelOp.meta?.speedUp?.isCancel).toBe(true)
  })

  test('the empty call is the same call a Safe rejection is made of', () => {
    const cancelOp = toCancelAccountOp(pendingOp())

    expect(isSafeRejectionCall(cancelOp.calls, accountAddr)).toBe(true)
  })

  test('does not change the pending transaction it is made from', () => {
    const op = pendingOp()
    toCancelAccountOp(op)

    expect(op.calls).toHaveLength(1)
    expect(op.calls[0]!.value).toBe(ethers.parseEther('1'))
    expect(op.signature).toBe('0xsignature')
    expect(op.meta?.setDelegation).toBe(true)
  })
})

describe('getCancelledNonce', () => {
  const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
  const broadcaster = '0xc4ce03b36f057591b2a360d773edb9896255051e'
  const feePaidWith = (broadcastOption: string): GasFeePayment => ({
    isGasTank: false,
    paidBy: broadcastOption === BROADCAST_OPTIONS.byOtherEOA ? broadcaster : accountAddr,
    paidByKeyType: 'internal',
    inToken: ZeroAddress,
    amount: 1000n,
    simulatedGasLimit: 21000n,
    gasPrice: 10n,
    broadcastOption
  })
  // The smart account nonce (0) and the transaction count (12) differ, like on a 7702 EOA
  const cancelOp = (
    broadcastOption: string,
    overrides: Partial<Pick<AccountOp, 'nonce' | 'eoaNonce' | 'meta'>> = {}
  ) => ({
    nonce: 0n,
    eoaNonce: 12n,
    gasFeePayment: feePaidWith(broadcastOption),
    meta: { speedUp: { enabled: true, isCancel: true } },
    ...overrides
  })

  test.each([
    ['an EOA', BROADCAST_OPTIONS.bySelf],
    ['a 7702 EOA', BROADCAST_OPTIONS.bySelf7702],
    ['an EOA that delegates', BROADCAST_OPTIONS.delegation]
  ])('%s sending it itself shows its transaction count', (_, broadcastOption) => {
    expect(getCancelledNonce(cancelOp(broadcastOption))).toBe(12n)
  })

  test('an EOA sending it itself ignores the smart account nonce it remembered', () => {
    const op = cancelOp(BROADCAST_OPTIONS.bySelf7702, {
      meta: { speedUp: { enabled: true, isCancel: true, replacedNonce: 0n } }
    })

    expect(getCancelledNonce(op)).toBe(12n)
  })

  test('an EOA sending it itself without a known transaction count shows none', () => {
    expect(getCancelledNonce(cancelOp(BROADCAST_OPTIONS.bySelf, { eoaNonce: undefined }))).toBe(
      null
    )
  })

  test('a smart account sent by another account shows the smart account nonce it signed', () => {
    const op = cancelOp(BROADCAST_OPTIONS.byOtherEOA, {
      nonce: 6n,
      meta: { speedUp: { enabled: true, isCancel: true, replacedNonce: 5n } }
    })

    expect(getCancelledNonce(op)).toBe(5n)
  })

  test('a smart account falls back to its nonce if none was remembered', () => {
    expect(getCancelledNonce(cancelOp(BROADCAST_OPTIONS.byOtherEOA, { nonce: 6n }))).toBe(6n)
  })

  test('a remembered nonce of 0 is used, not skipped', () => {
    const op = cancelOp(BROADCAST_OPTIONS.byOtherEOA, {
      nonce: 1n,
      meta: { speedUp: { enabled: true, isCancel: true, replacedNonce: 0n } }
    })

    expect(getCancelledNonce(op)).toBe(0n)
  })

  test('is null for a speed up that is not a cancel', () => {
    const op = cancelOp(BROADCAST_OPTIONS.bySelf, { meta: { speedUp: { enabled: true } } })

    expect(getCancelledNonce(op)).toBeNull()
  })

  test('is null for a regular transaction', () => {
    expect(getCancelledNonce(cancelOp(BROADCAST_OPTIONS.bySelf, { meta: undefined }))).toBeNull()
  })

  test('is null if the speed up is not enabled', () => {
    const op = cancelOp(BROADCAST_OPTIONS.bySelf, {
      meta: { speedUp: { enabled: false, isCancel: true } }
    })

    expect(getCancelledNonce(op)).toBeNull()
  })
})

describe('isCancelAccountOp', () => {
  test('is a cancel when the speed up is enabled and marked as a cancel', () => {
    expect(isCancelAccountOp({ meta: { speedUp: { enabled: true, isCancel: true } } })).toBe(true)
  })

  test.each([
    ['a regular transaction', {}],
    ['a transaction without a speed up', { meta: {} }],
    ['a speed up', { meta: { speedUp: { enabled: true } } }],
    [
      'a disabled speed up marked as a cancel',
      { meta: { speedUp: { enabled: false, isCancel: true } } }
    ]
  ])('is not a cancel for %s', (_, accountOp) => {
    expect(isCancelAccountOp(accountOp)).toBe(false)
  })
})

describe('hasCancelCalls', () => {
  const emptyCall = { to: ZeroAddress, value: 0n, data: '0x' }

  test('a cancel is made of empty calls to the zero address', () => {
    expect(hasCancelCalls([emptyCall])).toBe(true)
    expect(hasCancelCalls([emptyCall, emptyCall])).toBe(true)
  })

  test.each([
    ['no calls', []],
    ['a call that sends value', [{ ...emptyCall, value: 1n }]],
    ['a call with data', [{ ...emptyCall, data: '0x01' }]],
    [
      'a call to another address',
      [{ ...emptyCall, to: '0xc4ce03b36f057591b2a360d773edb9896255051e' }]
    ],
    ['an empty call next to a real one', [emptyCall, { ...emptyCall, value: 1n }]]
  ])('%s is not a cancel', (_, calls) => {
    expect(hasCancelCalls(calls)).toBe(false)
  })
})

describe('toCancelAccountOp of a pending cancel being sped up', () => {
  const accountAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
  const pendingCancel: AccountOp = {
    id: 'pending-cancel',
    accountAddr,
    chainId: 8453n,
    signingKeyAddr: accountAddr,
    signingKeyType: 'internal',
    nonce: 301n,
    eoaNonce: 12n,
    calls: [{ id: 'cancel', to: ZeroAddress, value: 0n, data: '0x' }],
    gasLimit: 50000,
    signature: '0xownerssignatures',
    signed: [accountAddr],
    txnId: '0xonchainhash',
    gasFeePayment: null,
    meta: {
      speedUp: {
        enabled: true,
        isCancel: true,
        replacedNonce: 301n,
        replacedIdentifiedBy: { type: 'Transaction', identifier: '0xonchainhash' }
      }
    }
  }

  test('keeps the signatures, as they apply to the same empty calls', () => {
    const cancelOp = toCancelAccountOp(pendingCancel)

    expect(cancelOp.signature).toBe('0xownerssignatures')
    expect(cancelOp.signed).toEqual([accountAddr])
    expect(cancelOp.txnId).toBe('0xonchainhash')
    expect(cancelOp.gasLimit).toBe(50000)
  })

  test('keeps the signer and the calls', () => {
    const cancelOp = toCancelAccountOp(pendingCancel)

    expect(cancelOp.signingKeyAddr).toBe(accountAddr)
    expect(cancelOp.calls).toEqual(pendingCancel.calls)
  })

  test('stays a cancel of the same nonce', () => {
    expect(toCancelAccountOp(pendingCancel).meta?.speedUp).toMatchObject({
      enabled: true,
      isCancel: true,
      replacedNonce: 301n
    })
  })

  test('building a new cancel again keeps it unsigned', () => {
    const newCancel = toCancelAccountOp({
      ...pendingCancel,
      calls: [{ to: accountAddr, value: 1n, data: '0x' }]
    })

    expect(toCancelAccountOp(newCancel).signature).toBeNull()
  })
})
