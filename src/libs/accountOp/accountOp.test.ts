import { ethers, ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import {
  AccountOp,
  accountOpSignableHash,
  GasFeePayment,
  getPq1BroadcastBlocker,
  isSafeRejectionCall,
  isSameChainAndSender
} from './accountOp'
import { Call } from './types'

describe('AccountOp', () => {
  test('should generate a valid hash for signing', async () => {
    const nonce = 0n
    const ambireAccountAddress = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const signerAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const txns: Call[] = [{ to: signerAddr, value: ethers.parseEther('0.01'), data: '0x00' }]
    const op: AccountOp = {
      accountAddr: ambireAccountAddress,
      chainId: 1n,
      signingKeyAddr: null,
      signingKeyType: null,
      nonce,
      calls: txns,
      gasLimit: null,
      signature: null,
      gasFeePayment: null
    }
    const accountOpHash = accountOpSignableHash(op, 1n)
    expect(ethers.hexlify(accountOpHash)).toBe(
      '0xf4c15be577fe5a65920c66a16ba3ada4650c6daf53851d630d7b40a9e24b7a72'
    )
  })
  test('should pass null as nonce in AccountOp and it should generate a valid hash with nonce 0', async () => {
    const ambireAccountAddress = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const signerAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const txns: Call[] = [{ to: signerAddr, value: ethers.parseEther('0.01'), data: '0x00' }]
    const op: AccountOp = {
      accountAddr: ambireAccountAddress,
      chainId: 1n,
      signingKeyAddr: null,
      signingKeyType: null,
      nonce: null,
      calls: txns,
      gasLimit: null,
      signature: null,
      gasFeePayment: null
    }
    const accountOpHash = accountOpSignableHash(op, 1n)
    // if the above statement does not throw an error, we're good
    expect(ethers.hexlify(accountOpHash)).not.toBe(null)
  })
})

describe('isSafeRejectionCall', () => {
  const safeAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
  const zeroAddress = '0x0000000000000000000000000000000000000000'

  test('marks a single empty call to the zero address as a rejection', () => {
    const calls: Call[] = [{ to: zeroAddress, value: 0n, data: '0x' }]
    expect(isSafeRejectionCall(calls, safeAddr)).toBe(true)
  })

  test('marks a single empty call to the Safe itself as a rejection', () => {
    const calls: Call[] = [{ to: safeAddr, value: 0n, data: '0x' }]
    expect(isSafeRejectionCall(calls, safeAddr)).toBe(true)
  })

  test('is case-insensitive when comparing the call target to the Safe address', () => {
    const calls: Call[] = [{ to: safeAddr.toUpperCase(), value: 0n, data: '0x' }]
    expect(isSafeRejectionCall(calls, safeAddr)).toBe(true)
  })

  test('does not mark a call that carries value', () => {
    const calls: Call[] = [{ to: zeroAddress, value: 1n, data: '0x' }]
    expect(isSafeRejectionCall(calls, safeAddr)).toBe(false)
  })

  test('does not mark a call that carries data', () => {
    const calls: Call[] = [{ to: zeroAddress, value: 0n, data: '0x01' }]
    expect(isSafeRejectionCall(calls, safeAddr)).toBe(false)
  })

  test('does not mark a call to an unrelated address', () => {
    const calls: Call[] = [
      { to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', value: 0n, data: '0x' }
    ]
    expect(isSafeRejectionCall(calls, safeAddr)).toBe(false)
  })

  test('does not mark a contract-deployment call (no `to`)', () => {
    const calls: Call[] = [{ value: 0n, data: '0x' }]
    expect(isSafeRejectionCall(calls, safeAddr)).toBe(false)
  })

  test('does not mark a delegate call', () => {
    const calls: Call[] = [{ to: zeroAddress, value: 0n, data: '0x' }]
    expect(isSafeRejectionCall(calls, safeAddr, 1)).toBe(false)
  })

  test('does not mark a batch of otherwise-qualifying calls', () => {
    const calls: Call[] = [
      { to: zeroAddress, value: 0n, data: '0x' },
      { to: zeroAddress, value: 0n, data: '0x' }
    ]
    expect(isSafeRejectionCall(calls, safeAddr)).toBe(false)
  })

  test('does not mark an empty calls array', () => {
    expect(isSafeRejectionCall([], safeAddr)).toBe(false)
  })

  describe('isSameChainAndSender', () => {
    const SMART = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
    const EOA = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const OTHER = '0x8f4B2F3e18a4E1Fc5c9d95e1eE5A9B37a55f6A67'
    const op = (accountAddr: string, paidBy?: string, chainId = 8453n) =>
      ({
        accountAddr,
        chainId,
        gasFeePayment: paidBy ? { paidBy } : null
      }) as Pick<AccountOp, 'accountAddr' | 'chainId' | 'gasFeePayment'>

    test('a smart account paid by EOA E and E itself share a sender', () => {
      expect(isSameChainAndSender(op(SMART, EOA), op(EOA, EOA))).toBe(true)
      expect(isSameChainAndSender(op(EOA, EOA), op(SMART, EOA.toLowerCase()))).toBe(true)
    })

    test('the same account without a fee payer yet shares a sender', () => {
      expect(isSameChainAndSender(op(SMART), op(SMART))).toBe(true)
    })

    test('unrelated accounts, or the same account on another chain, do not', () => {
      expect(isSameChainAndSender(op(SMART, EOA), op(OTHER, OTHER))).toBe(false)
      expect(isSameChainAndSender(op(EOA, EOA), op(EOA, EOA, 1n))).toBe(false)
    })
  })
})

describe('getPq1BroadcastBlocker', () => {
  const pq1Wallet = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
  const safeAddr = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
  const otherPayer = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const OWN_ACCOUNT_ONLY = /only send transactions from its own account/
  const NATIVE_FEE_ONLY = /can only pay the fee themselves/

  const nativeFeePaidBy = (paidBy: string): GasFeePayment => ({
    isGasTank: false,
    paidBy,
    paidByKeyType: 'pq1',
    inToken: ZeroAddress,
    amount: 21000n,
    simulatedGasLimit: 21000n,
    gasPrice: 1n,
    broadcastOption: BROADCAST_OPTIONS.bySelf
  })

  const pq1Op = (overrides: Partial<AccountOp> = {}): AccountOp => ({
    id: 'pq1-op',
    accountAddr: pq1Wallet,
    chainId: 8453n,
    signingKeyAddr: pq1Wallet,
    signingKeyType: 'pq1',
    nonce: null,
    calls: [{ to: otherPayer, value: 1n, data: '0x' }],
    gasLimit: null,
    signature: '0x',
    gasFeePayment: nativeFeePaidBy(pq1Wallet),
    ...overrides
  })

  test('allows a PQ1 account that pays its own fee in the native token', () => {
    expect(getPq1BroadcastBlocker(pq1Op())).toBeNull()
  })

  test('refuses an op for a Safe the PQ1 is an owner of, even when the Safe pays its own fee', () => {
    // Broadcast through the PQ1 pipeline, the Safe's calls would run from the PQ1 wallet.
    const safeOp = pq1Op({ accountAddr: safeAddr, gasFeePayment: nativeFeePaidBy(safeAddr) })
    expect(getPq1BroadcastBlocker(safeOp)).toMatch(OWN_ACCOUNT_ONLY)
  })

  test('refuses an op without a signing key', () => {
    expect(getPq1BroadcastBlocker(pq1Op({ signingKeyAddr: null }))).toMatch(OWN_ACCOUNT_ONLY)
  })

  test.each([
    ['from the gas tank', { isGasTank: true }],
    ['by another account', { paidBy: otherPayer }],
    ['in a token', { inToken: usdc }]
  ])('refuses a fee paid %s', (_, feeOverrides: Partial<GasFeePayment>) => {
    const gasFeePayment = { ...nativeFeePaidBy(pq1Wallet), ...feeOverrides }
    expect(getPq1BroadcastBlocker(pq1Op({ gasFeePayment }))).toMatch(NATIVE_FEE_ONLY)
  })

  test('refuses an op without a fee payment', () => {
    expect(getPq1BroadcastBlocker(pq1Op({ gasFeePayment: null }))).toMatch(NATIVE_FEE_ONLY)
  })
})
