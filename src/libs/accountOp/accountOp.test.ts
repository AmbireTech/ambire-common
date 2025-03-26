import { ethers } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { AccountOp, accountOpSignableHash } from './accountOp'
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
      gasFeePayment: null,
      accountOpToExecuteBefore: null
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
      gasFeePayment: null,
      accountOpToExecuteBefore: null
    }
    const accountOpHash = accountOpSignableHash(op, 1n)
    // if the above statement does not throw an error, we're good
    expect(ethers.hexlify(accountOpHash)).not.toBe(null)
  })
})
