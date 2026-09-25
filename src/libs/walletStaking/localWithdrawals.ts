import { Interface, isHexString } from 'ethers'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import { withTimeout } from '../../utils/with-timeout'
import { AccountOpStatus } from '../accountOp/types'
import {
  getUniqueAccountWalletStakingLeaveLogs,
  WalletStakingRelayerLog
} from './pendingWithdrawal'

import type { SubmittedAccountOp } from '../accountOp/submittedAccountOp'

export const WALLET_STAKING_RECEIPT_RPC_TIMEOUT_MS = 6000

const WALLET_STAKING_LEAVE_SELECTOR = new Interface([
  'function leave(uint256 shares, bool skipMint)'
]).getFunction('leave')!.selector

const FAILED_ACCOUNT_OP_STATUSES = [AccountOpStatus.Failure, AccountOpStatus.Rejected]

export interface WalletStakingReceiptLog {
  address: string
  topics: readonly string[]
  data: string
}

/** The account's WALLET staking leave logs found in one transaction, in the relayer's shape. */
export interface TxnWalletStakingLeaveLogs {
  txnId: string
  logs: WalletStakingRelayerLog[]
}

/** Checks if the text is a valid transaction id (a 32-byte hex hash). */
export const isValidWalletStakingTxnId = (value: string) => isHexString(value.trim(), 32)

/**
 * Returns the ids of the locally known transactions that called the WALLET staking `leave`
 * method (an unstake). Transactions that failed or were rejected are ignored.
 */
export const getWalletStakingLeaveTxnIds = (accountOps: SubmittedAccountOp[]): string[] => {
  const stakingAddr = WALLET_STAKING_ADDR.toLowerCase()
  const txnIds = accountOps
    .filter(
      ({ txnId, status, calls }) =>
        !!txnId &&
        !FAILED_ACCOUNT_OP_STATUSES.includes(status as AccountOpStatus) &&
        calls.some(
          ({ to, data }) =>
            to?.toLowerCase() === stakingAddr &&
            data.toLowerCase().startsWith(WALLET_STAKING_LEAVE_SELECTOR)
        )
    )
    .map(({ txnId }) => txnId!.toLowerCase())

  return Array.from(new Set(txnIds))
}

/**
 * Returns the account's WALLET staking leave logs from the logs of a transaction receipt, in the
 * relayer's shape. Only logs that the staking contract emitted are trusted.
 */
export const getAccountLeaveLogsFromReceiptLogs = (
  logs: readonly WalletStakingReceiptLog[],
  accountAddr: string
): WalletStakingRelayerLog[] => {
  const stakingAddr = WALLET_STAKING_ADDR.toLowerCase()
  const stakingLogs = logs
    .filter(({ address }) => address.toLowerCase() === stakingAddr)
    .map(({ topics, data }) => ({ topics: [...topics], data }))

  return getUniqueAccountWalletStakingLeaveLogs(stakingLogs, accountAddr).map(({ log }) => log)
}

/**
 * Reads the receipts of the transactions from the RPC and returns the account's WALLET staking
 * leave logs from them. It does not contact the relayer, so the account address stays private.
 * A transaction without a receipt (unknown or not mined yet) returns no logs.
 */
export const findWalletStakingLeaveLogsInTxns = async (
  txnIds: string[],
  accountAddr: string,
  provider: RPCProvider
): Promise<{
  results: TxnWalletStakingLeaveLogs[]
  failedTxnIds: string[]
  errors: Error[]
}> => {
  const uniqueTxnIds = Array.from(new Set(txnIds.map((txnId) => txnId.trim().toLowerCase())))
  const settledResults = await Promise.allSettled(
    uniqueTxnIds.map(async (txnId) => {
      if (!isValidWalletStakingTxnId(txnId)) throw new Error(`Invalid transaction id: ${txnId}`)

      const receipt = await withTimeout(() => provider.getTransactionReceipt(txnId), {
        timeoutMs: WALLET_STAKING_RECEIPT_RPC_TIMEOUT_MS,
        message: 'The transaction took too long to load.'
      })
      return {
        txnId,
        logs: receipt ? getAccountLeaveLogsFromReceiptLogs(receipt.logs, accountAddr) : []
      }
    })
  )

  return settledResults.reduce<{
    results: TxnWalletStakingLeaveLogs[]
    failedTxnIds: string[]
    errors: Error[]
  }>(
    (summary, result, index) => {
      if (result.status === 'fulfilled') {
        summary.results.push(result.value)
        return summary
      }

      summary.failedTxnIds.push(uniqueTxnIds[index]!)
      summary.errors.push(
        result.reason instanceof Error
          ? result.reason
          : new Error('Unable to load the transaction.')
      )
      return summary
    },
    { results: [], failedTxnIds: [], errors: [] }
  )
}
