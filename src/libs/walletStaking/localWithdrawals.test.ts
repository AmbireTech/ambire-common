import { Interface } from 'ethers'

import { expect, jest } from '@jest/globals'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOpStatus } from '../accountOp/types'
import {
  decodePendingWalletWithdrawalsFromReceiptLogs,
  findPendingWalletWithdrawalsInTxns,
  getWalletStakingLeaveTxnIds,
  isValidWalletStakingTxnId
} from './localWithdrawals'
import { PendingWalletWithdrawal, walletStakingInterface } from './pendingWithdrawal'

import type { SubmittedAccountOp } from '../accountOp/submittedAccountOp'

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const OTHER_ACCOUNT = '0x2222222222222222222222222222222222222222'
const OTHER_CONTRACT = '0x3333333333333333333333333333333333333333'
const TXN_ID_1 = `0x${'a'.repeat(64)}`
const TXN_ID_2 = `0x${'b'.repeat(64)}`
const TXN_ID_3 = `0x${'c'.repeat(64)}`
const leaveInterface = new Interface([
  'function leave(uint256 shares, bool skipMint)',
  'function withdraw(uint256 shares, uint256 unlocksAt, bool skipMint)'
])
const LEAVE_DATA = leaveInterface.encodeFunctionData('leave', [10n, false])
const WITHDRAW_DATA = leaveInterface.encodeFunctionData('withdraw', [10n, 100n, false])

const withdrawal: PendingWalletWithdrawal = { shares: 10n, unlocksAt: 100n, maxTokens: 1000n }

const getLeaveLog = (
  accountAddr: string,
  { shares, unlocksAt, maxTokens }: PendingWalletWithdrawal,
  address = WALLET_STAKING_ADDR
) => {
  const { data, topics } = walletStakingInterface.encodeEventLog(
    walletStakingInterface.getEvent('LogLeave')!,
    [accountAddr, shares, unlocksAt, maxTokens]
  )

  return { address, data, topics }
}

const getAccountOp = (
  txnId: string | undefined,
  calls: { to: string; data: string }[],
  status: AccountOpStatus = AccountOpStatus.Success
) =>
  ({
    txnId,
    status,
    calls: calls.map((call) => ({ ...call, value: 0n }))
  }) as unknown as SubmittedAccountOp

const getProvider = (receipts: Record<string, unknown>) =>
  ({
    getTransactionReceipt: jest.fn(async (txnId: string) => {
      const receipt = receipts[txnId]
      if (receipt instanceof Error) throw receipt
      return receipt ?? null
    })
  }) as unknown as RPCProvider

describe('isValidWalletStakingTxnId', () => {
  test('accepts 32-byte hex hashes, also with spaces around them', () => {
    expect(isValidWalletStakingTxnId(TXN_ID_1)).toBe(true)
    expect(isValidWalletStakingTxnId(`  ${TXN_ID_1.toUpperCase().replace('0X', '0x')} `)).toBe(true)
  })

  test('rejects addresses, short hashes and other text', () => {
    expect(isValidWalletStakingTxnId(ACCOUNT)).toBe(false)
    expect(isValidWalletStakingTxnId(TXN_ID_1.slice(0, -2))).toBe(false)
    expect(isValidWalletStakingTxnId('a'.repeat(64))).toBe(false)
    expect(isValidWalletStakingTxnId('')).toBe(false)
  })
})

describe('getWalletStakingLeaveTxnIds', () => {
  test('returns only the unique ids of transactions that call leave on the staking contract', () => {
    const accountOps = [
      getAccountOp(TXN_ID_1, [
        { to: OTHER_CONTRACT, data: '0x' },
        { to: WALLET_STAKING_ADDR.toLowerCase(), data: LEAVE_DATA }
      ]),
      getAccountOp(TXN_ID_1.toUpperCase().replace('0X', '0x'), [
        { to: WALLET_STAKING_ADDR, data: LEAVE_DATA }
      ]),
      getAccountOp(TXN_ID_2, [{ to: WALLET_STAKING_ADDR, data: WITHDRAW_DATA }]),
      getAccountOp(TXN_ID_3, [{ to: OTHER_CONTRACT, data: LEAVE_DATA }])
    ]

    expect(getWalletStakingLeaveTxnIds(accountOps)).toEqual([TXN_ID_1])
  })

  test('ignores failed, rejected and not yet sent transactions', () => {
    const leaveCall = { to: WALLET_STAKING_ADDR, data: LEAVE_DATA }
    const accountOps = [
      getAccountOp(TXN_ID_1, [leaveCall], AccountOpStatus.Failure),
      getAccountOp(TXN_ID_2, [leaveCall], AccountOpStatus.Rejected),
      getAccountOp(undefined, [leaveCall], AccountOpStatus.Pending),
      getAccountOp(TXN_ID_3, [leaveCall], AccountOpStatus.BroadcastedButNotConfirmed)
    ]

    expect(getWalletStakingLeaveTxnIds(accountOps)).toEqual([TXN_ID_3])
  })
})

describe('decodePendingWalletWithdrawalsFromReceiptLogs', () => {
  test('decodes only the leave events of the account emitted by the staking contract', () => {
    const logs = [
      getLeaveLog(ACCOUNT, withdrawal),
      getLeaveLog(OTHER_ACCOUNT, { ...withdrawal, shares: 20n }),
      // The same event from another contract must not be trusted
      getLeaveLog(ACCOUNT, { ...withdrawal, shares: 30n }, OTHER_CONTRACT),
      { address: WALLET_STAKING_ADDR, topics: [`0x${'0'.repeat(64)}`], data: '0x' }
    ]

    expect(decodePendingWalletWithdrawalsFromReceiptLogs(logs, ACCOUNT.toUpperCase())).toEqual([
      withdrawal
    ])
  })
})

describe('findPendingWalletWithdrawalsInTxns', () => {
  test('reads each unique receipt once and returns the withdrawals as strings', async () => {
    const provider = getProvider({
      [TXN_ID_1]: { logs: [getLeaveLog(ACCOUNT, withdrawal)] },
      [TXN_ID_2]: { logs: [] }
    })

    const result = await findPendingWalletWithdrawalsInTxns(
      [TXN_ID_1, ` ${TXN_ID_1.toUpperCase().replace('0X', '0x')}`, TXN_ID_2, TXN_ID_3],
      ACCOUNT,
      provider
    )

    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      results: [
        {
          txnId: TXN_ID_1,
          withdrawals: [{ shares: '10', unlocksAt: '100', maxTokens: '1000' }]
        },
        { txnId: TXN_ID_2, withdrawals: [] },
        // No receipt: unknown or not mined yet
        { txnId: TXN_ID_3, withdrawals: [] }
      ],
      failedTxnIds: [],
      errors: []
    })
  })

  test('reports invalid ids and failed receipts without dropping the other results', async () => {
    const provider = getProvider({
      [TXN_ID_1]: { logs: [getLeaveLog(ACCOUNT, withdrawal)] },
      [TXN_ID_2]: new Error('RPC is down')
    })

    const result = await findPendingWalletWithdrawalsInTxns(
      [TXN_ID_1, TXN_ID_2, 'not-a-txn-id'],
      ACCOUNT,
      provider
    )

    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(2)
    expect(result.results).toEqual([
      { txnId: TXN_ID_1, withdrawals: [{ shares: '10', unlocksAt: '100', maxTokens: '1000' }] }
    ])
    expect(result.failedTxnIds).toEqual([TXN_ID_2, 'not-a-txn-id'])
    expect(result.errors.map(({ message }) => message)).toEqual([
      'RPC is down',
      'Invalid transaction id: not-a-txn-id'
    ])
  })

  test('does not return withdrawals of another account from the same transaction', async () => {
    const provider = getProvider({
      [TXN_ID_1]: { logs: [getLeaveLog(OTHER_ACCOUNT, withdrawal)] }
    })

    const result = await findPendingWalletWithdrawalsInTxns([TXN_ID_1], ACCOUNT, provider)

    expect(result.results).toEqual([{ txnId: TXN_ID_1, withdrawals: [] }])
  })
})
