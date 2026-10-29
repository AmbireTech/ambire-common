import { SafeMultisigTransactionResponse } from '@safe-global/types-kit'
import { JsonRpcProvider, Network } from 'ethers'

import { AccountOp } from '../../libs/accountOp/accountOp'
import {
  getFeeTokenPriceUnavailableWarning,
  getSafeDelegateCallWarning,
  getSafeGasRefundWarning,
  isNonceTooLow,
  isReplacementRefused,
  isTxnAlreadyKnown
} from './helper'

const buildSafeTxFixture = (
  overrides: Partial<SafeMultisigTransactionResponse>
): SafeMultisigTransactionResponse => ({
  safe: '0x0000000000000000000000000000000000000000',
  to: '0x0000000000000000000000000000000000000000',
  value: '0',
  operation: 0,
  gasToken: '0x0000000000000000000000000000000000000000',
  safeTxGas: '0',
  baseGas: '0',
  gasPrice: '0',
  nonce: '0',
  executionDate: null,
  submissionDate: '2024-01-01T00:00:00Z',
  modified: '2024-01-01T00:00:00Z',
  blockNumber: null,
  transactionHash: null,
  safeTxHash: '0x0',
  executor: null,
  proposer: null,
  proposedByDelegate: null,
  isExecuted: false,
  isSuccessful: null,
  ethGasPrice: null,
  maxFeePerGas: null,
  maxPriorityFeePerGas: null,
  gasUsed: null,
  fee: null,
  origin: '',
  confirmationsRequired: 1,
  trusted: true,
  signatures: null,
  ...overrides
})

const accountOp: AccountOp = {
  accountAddr: '0x6969174FD72466430a46e18234D0b530c9FD5f49',
  chainId: 42161n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null,
  id: 'testSafe'
}

describe('getSafeDelegateCallWarning', () => {
  test('warns once, at the accountOp level, when the Safe tx is a delegatecall to an unwhitelisted contract', () => {
    const accOpWithSafeTx: AccountOp = {
      ...accountOp,
      safeTx: buildSafeTxFixture({
        operation: 1,
        to: '0x9999999999999999999999999999999999999999'
      })
    }

    const warning = getSafeDelegateCallWarning(accOpWithSafeTx)

    expect(warning).toBeTruthy()
    expect(warning?.id).toBe('safeDelegateCall')
  })

  test('does not warn when the Safe tx operation is a regular call (operation 0)', () => {
    const accOpWithSafeTx: AccountOp = {
      ...accountOp,
      safeTx: buildSafeTxFixture({
        operation: 0,
        to: '0x9999999999999999999999999999999999999999'
      })
    }

    expect(getSafeDelegateCallWarning(accOpWithSafeTx)).toBeNull()
  })

  test('does not warn when accountOp.safeTx is not set', () => {
    expect(getSafeDelegateCallWarning(accountOp)).toBeNull()
  })
})

describe('getFeeTokenPriceUnavailableWarning', () => {
  test('warns when fee speeds exist but their USD prices are unavailable', () => {
    expect(getFeeTokenPriceUnavailableWarning(true, false, true)?.id).toBe(
      'feeTokenPriceUnavailable'
    )
  })

  test('does not warn when token prices are disabled', () => {
    expect(getFeeTokenPriceUnavailableWarning(true, false, false)).toBeNull()
  })

  test('does not warn when fee speeds are unavailable or already have USD prices', () => {
    expect(getFeeTokenPriceUnavailableWarning(false, false, true)).toBeNull()
    expect(getFeeTokenPriceUnavailableWarning(true, true, true)).toBeNull()
  })
})

describe('getSafeGasRefundWarning', () => {
  test('warns, at the accountOp level, when the Safe tx pays a gas refund to a fixed address', () => {
    const accOpWithSafeTx: AccountOp = {
      ...accountOp,
      safeTx: buildSafeTxFixture({
        baseGas: '1',
        gasPrice: '1',
        refundReceiver: '0x9999999999999999999999999999999999999999'
      })
    }

    const warning = getSafeGasRefundWarning(accOpWithSafeTx)

    expect(warning).toBeTruthy()
    expect(warning?.id).toBe('safeGasRefund')
    // this renders as a standalone banner, so it must spell out the address itself rather than
    // reference "the address below"/"shown above" - there's no adjacent visualization to point at
    expect(warning?.text).toContain('0x9999999999999999999999999999999999999999')
    expect(warning?.text).not.toMatch(/below|above/)
  })

  test('warns when the Safe tx pays a gas refund to whoever broadcasts it (no fixed refundReceiver)', () => {
    const accOpWithSafeTx: AccountOp = {
      ...accountOp,
      safeTx: buildSafeTxFixture({
        baseGas: '1',
        gasPrice: '1',
        refundReceiver: '0x0000000000000000000000000000000000000000'
      })
    }

    const warning = getSafeGasRefundWarning(accOpWithSafeTx)

    expect(warning).toBeTruthy()
    expect(warning?.id).toBe('safeGasRefund')
    expect(warning?.text).toContain('whoever broadcasts it')
    expect(warning?.text).not.toMatch(/below|above/)
  })

  test('does not warn when gasPrice is 0 (no gas refund is paid)', () => {
    const accOpWithSafeTx: AccountOp = {
      ...accountOp,
      safeTx: buildSafeTxFixture({
        baseGas: '1',
        gasPrice: '0',
        refundReceiver: '0x9999999999999999999999999999999999999999'
      })
    }

    expect(getSafeGasRefundWarning(accOpWithSafeTx)).toBeNull()
  })

  test('does not warn when accountOp.safeTx is not set', () => {
    expect(getSafeGasRefundWarning(accountOp)).toBeNull()
  })
})

describe('broadcast error checks', () => {
  const provider = new JsonRpcProvider('http://127.0.0.1:1', Network.from(1), {
    staticNetwork: Network.from(1)
  })
  afterAll(() => provider.destroy())

  // Built the way ethers builds them from a node answer to eth_sendRawTransaction
  const nodeError = (message: string) =>
    provider.getRpcError(
      { method: 'eth_sendRawTransaction', params: ['0x00'], id: 1, jsonrpc: '2.0' },
      { id: 1, error: { code: -32000, message } }
    )

  test('isReplacementRefused matches the node refusal, also without the ethers mapping', () => {
    expect(isReplacementRefused(nodeError('replacement transaction underpriced'))).toBe(true)
    expect(isReplacementRefused(new Error('replacement transaction underpriced'))).toBe(true)
    expect(isReplacementRefused(nodeError('nonce too low'))).toBe(false)
    expect(isReplacementRefused(nodeError('transaction underpriced'))).toBe(false)
  })

  test('isNonceTooLow matches the node answer in any form', () => {
    expect(isNonceTooLow(nodeError('nonce too low'))).toBe(true)
    expect(isNonceTooLow(nodeError('nonce too low: next nonce 8, tx nonce 7'))).toBe(true)
    expect(isNonceTooLow(new Error('nonce too low'))).toBe(true)
    expect(isNonceTooLow(nodeError('replacement transaction underpriced'))).toBe(false)
  })

  test('isTxnAlreadyKnown matches only a node that already has the txn', () => {
    expect(isTxnAlreadyKnown(nodeError('already known'))).toBe(true)
    expect(isTxnAlreadyKnown(new Error('already known'))).toBe(true)
    // The txn never went out, so it must not count as sent
    expect(isTxnAlreadyKnown(nodeError('unknown transaction type'))).toBe(false)
    expect(isTxnAlreadyKnown(nodeError('nonce too low'))).toBe(false)
    expect(isTxnAlreadyKnown(nodeError('replacement transaction underpriced'))).toBe(false)
    expect(isTxnAlreadyKnown('already known')).toBe(false)
  })
})
