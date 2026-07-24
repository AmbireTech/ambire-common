import { SafeMultisigTransactionResponse } from '@safe-global/types-kit'

import { AccountOp } from '../../libs/accountOp/accountOp'
import { getSafeDelegateCallWarning } from './helper'

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
