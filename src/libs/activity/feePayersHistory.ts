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
 * Whether an op with this status is known to be on-chain, mined successfully or not. Only then
 * is its fee payer publicly linked to the account. Pending, stuck and unknown ops may never land
 * (e.g. replaced or dropped), and counting their payer as linked would skip the warning for a
 * payer that is not linked yet - so they are left out, which errs on the side of warning.
 */
export const hasOpReachedChain = (status: AccountOpStatus | undefined): boolean =>
  status === AccountOpStatus.Success ||
  status === AccountOpStatus.Failure ||
  status === AccountOpStatus.PartiallyComplete

/**
 * Record, in place, the fee payer of one op of `accountId`, if the op is on-chain (see
 * hasOpReachedChain). The single rule for every path that indexes payers: the status updates,
 * the one-time backfill from the stored history and getFeePayers' merge of the ops in memory.
 *
 * Ops without a bigint chainId or a numeric timestamp cannot be indexed, so they are skipped too.
 * Returns whether the history changed, so the caller persists only then.
 */
export function recordFeePayerOfOp(
  history: FeePayersHistory,
  accountId: string,
  op: SubmittedAccountOp | SubmittedAccountOpLike | null | undefined
): boolean {
  if (!op || !hasOpReachedChain(op.status)) return false
  if (typeof op.chainId !== 'bigint' || typeof op.timestamp !== 'number') return false

  return recordFeePayer(history, accountId, op.chainId, op.gasFeePayment?.paidBy, op.timestamp)
}
