import { FeePayersHistory } from '../../controllers/activity/types'
import { getAddressCaught } from '../../utils/getAddressCaught'
import { SubmittedAccountOp, SubmittedAccountOpLike } from '../accountOp/submittedAccountOp'
import { AccountOpStatus } from '../accountOp/types'

/**
 * Record, in place, that `paidBy` paid the fee for a transaction of `accountId` on `chainId`
 * at `timestamp`, keeping the latest payment of each payer. Payments made by the account itself
 * (e.g. gas tank or its own balance) link nothing new, so they are skipped.
 * Returns whether the history changed, so callers persist only then.
 */
export function recordFeePayer(
  history: FeePayersHistory,
  accountId: string,
  chainId: bigint,
  paidBy: string | undefined,
  timestamp: number
): boolean {
  const checksummedPaidBy = paidBy ? getAddressCaught(paidBy) : null
  const checksummedAccountId = getAddressCaught(accountId)
  if (!checksummedPaidBy || !checksummedAccountId) return false
  if (checksummedPaidBy === checksummedAccountId) return false

  const chainIdKey = chainId.toString()
  if (!history[checksummedAccountId]) history[checksummedAccountId] = {}
  const payers = history[checksummedAccountId]![chainIdKey] || {}
  const lastPaidAt = payers[checksummedPaidBy]
  if (lastPaidAt !== undefined && lastPaidAt >= timestamp) return false

  history[checksummedAccountId]![chainIdKey] = { ...payers, [checksummedPaidBy]: timestamp }
  return true
}

/**
 * Record, in place, the fee payer of one stored op of `accountId`. Used by the one-time pass that
 * backfills the index from the history stored before it existed.
 *
 * Rejected ops are skipped: they never reached the network, so they linked nothing (same rule as
 * ActivityController.getFeePayers). So are ops without a bigint chainId or a numeric timestamp,
 * which cannot be indexed.
 * Returns whether the history changed, so the caller persists only then.
 */
export function recordFeePayerOfOp(
  history: FeePayersHistory,
  accountId: string,
  op: SubmittedAccountOp | SubmittedAccountOpLike | null | undefined
): boolean {
  if (!op || op.status === AccountOpStatus.Rejected) return false
  if (typeof op.chainId !== 'bigint' || typeof op.timestamp !== 'number') return false

  return recordFeePayer(history, accountId, op.chainId, op.gasFeePayment?.paidBy, op.timestamp)
}
