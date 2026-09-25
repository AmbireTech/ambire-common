import { SafeMultisigTransactionResponse } from '@safe-global/types-kit'

import { AccountOp } from '../../libs/accountOp/accountOp'
import {
  getFeeTokenPriceUnavailableWarning,
  getSafeDelegateCallWarning,
  getSafeGasRefundWarning
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
