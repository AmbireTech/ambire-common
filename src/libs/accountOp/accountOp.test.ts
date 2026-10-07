import { ethers } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { AccountOp, accountOpSignableHash, isSafeRejectionCall } from './accountOp'
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
})
