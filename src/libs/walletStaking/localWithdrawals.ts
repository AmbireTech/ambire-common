import { Interface, isHexString } from 'ethers'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import { withTimeout } from '../../utils/with-timeout'
import { isIdentifiedByMultipleTxn } from '../accountOp/submittedAccountOp'
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

/**
 * Returns the ids of the locally known transactions that called the WALLET staking `leave`
 * method (an unstake). Transactions that failed or were rejected are ignored.
 */
export const getWalletStakingLeaveTxnIds = (accountOps: SubmittedAccountOp[]): string[] => {
  const stakingAddr = WALLET_STAKING_ADDR.toLowerCase()
  const txnIds = accountOps.flatMap(({ txnId, identifiedBy, status, calls }) => {
    if (status === AccountOpStatus.Failure || status === AccountOpStatus.Rejected) return []

    const leaveCall = calls.find(
      ({ to, data }) =>
        to?.toLowerCase() === stakingAddr &&
        data.toLowerCase().startsWith(WALLET_STAKING_LEAVE_SELECTOR)
    )
    // An EOA without 7702 sends each call of a batch as its own transaction, and the op's txnId is
    // only the last one - so the leave event is in the leave call's own transaction
    const leaveTxnId = isIdentifiedByMultipleTxn(identifiedBy) ? leaveCall?.txnId : txnId

    return leaveCall && leaveTxnId ? [leaveTxnId.toLowerCase()] : []
  })

  return Array.from(new Set(txnIds))
}

/**
 * Reads the receipts of the transactions from the RPC and returns the account's WALLET staking
 * leave logs from them, in the relayer's shape. Only logs that the staking contract emitted are
 * trusted. It does not contact the relayer, so the account address stays private. A transaction
 * without a receipt (unknown or not mined yet) returns no logs.
 */
export const findWalletStakingLeaveLogsInTxns = async (
  txnIds: string[],
  accountAddr: string,
  provider: RPCProvider
) => {
  const stakingAddr = WALLET_STAKING_ADDR.toLowerCase()
  const uniqueTxnIds = Array.from(new Set(txnIds.map((txnId) => txnId.trim().toLowerCase())))
  const settledResults = await Promise.allSettled(
    uniqueTxnIds.map(async (txnId) => {
      if (!isHexString(txnId, 32)) throw new Error(`Invalid transaction id: ${txnId}`)

      const receipt = await withTimeout(() => provider.getTransactionReceipt(txnId), {
        timeoutMs: WALLET_STAKING_RECEIPT_RPC_TIMEOUT_MS,
        message: 'The transaction took too long to load.'
      })
      const stakingLogs = (receipt?.logs || [])
        .filter(({ address }) => address.toLowerCase() === stakingAddr)
        .map(({ topics, data }) => ({ topics: [...topics], data }))

      return {
        txnId,
        logs: getUniqueAccountWalletStakingLeaveLogs(stakingLogs, accountAddr).map(({ log }) => log)
      }
    })
  )

  const results: { txnId: string; logs: WalletStakingRelayerLog[] }[] = []
  const failedTxnIds: string[] = []
  const errors: Error[] = []
  settledResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      results.push(result.value)
      return
    }

    failedTxnIds.push(uniqueTxnIds[index]!)
    errors.push(
      result.reason instanceof Error ? result.reason : new Error('Unable to load the transaction.')
    )
  })

  return { results, failedTxnIds, errors }
}
