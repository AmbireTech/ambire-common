import { FeePayersHistory } from '../../controllers/activity/types'
import { getAddressCaught } from '../../utils/getAddressCaught'

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
