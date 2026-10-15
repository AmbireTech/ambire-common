import { FeePayersHistory } from '../../controllers/activity/types'
import { getAddressCaught } from '../../utils/getAddressCaught'

/**
 * Record, in place, that `paidBy` paid the fee for a transaction of `accountId` on `chainId`.
 * Payments made by the account itself (e.g. gas tank or its own balance) link nothing new,
 * so they are skipped. Returns whether the history changed, so callers persist only then.
 */
export function recordFeePayer(
  history: FeePayersHistory,
  accountId: string,
  chainId: bigint,
  paidBy: string | undefined
): boolean {
  const checksummedPaidBy = paidBy ? getAddressCaught(paidBy) : null
  const checksummedAccountId = getAddressCaught(accountId)
  if (!checksummedPaidBy || !checksummedAccountId) return false
  if (checksummedPaidBy === checksummedAccountId) return false

  const chainIdKey = chainId.toString()
  if (!history[checksummedAccountId]) history[checksummedAccountId] = {}
  const payers = history[checksummedAccountId]![chainIdKey] || []
  if (payers.includes(checksummedPaidBy)) return false

  history[checksummedAccountId]![chainIdKey] = [...payers, checksummedPaidBy]
  return true
}
