import { SentToHistory } from '../../controllers/activity/types'
import { InternalAccountsOps } from '../../interfaces/activity'
import { getAddressCaught } from '../../utils/getAddressCaught'
import { getAccountOpRecipients, SubmittedAccountOp } from '../accountOp/submittedAccountOp'

/**
 * Record one recipient against an account, in place.
 *
 * Shared by ActivityController (on every broadcast) and the storage migration that seeds the
 * index from existing history, so the recency rule below has a single implementation.
 */
export function recordRecipient(
  history: SentToHistory,
  accountId: string,
  toAddress: string,
  toDomain: string | undefined,
  timestamp: number
): void {
  const checksummedAddress = getAddressCaught(toAddress)
  if (!checksummedAddress) return

  if (!history.recipients[accountId]) history.recipients[accountId] = {}
  const existing = history.recipients[accountId]![checksummedAddress] || 0
  history.recipients[accountId]![checksummedAddress] = Math.max(existing, timestamp)

  const normalized = toDomain?.toLowerCase().trim()
  if (!normalized) return

  // Keep the newest: the migration walks history out of order, so last-write-wins could point
  // a domain at an older address — feeding a wrong "previous address" to the send-screen
  // domain-change warning.
  const existingDomain = history.domains[normalized]
  if (existingDomain && existingDomain.sentAt > timestamp) return

  history.domains[normalized] = { address: checksummedAddress, sentAt: timestamp }
}

/** Index every recipient in `ops` into `history`, in place. */
export function indexRecipientsFromOps(history: SentToHistory, ops: InternalAccountsOps): void {
  for (const [accountAddr, byChain] of Object.entries(ops)) {
    for (const groupOps of Object.values(byChain)) {
      for (const op of groupOps ?? []) {
        getAccountOpRecipients(op as SubmittedAccountOp).forEach((recipient) =>
          recordRecipient(history, accountAddr, recipient.address, recipient.domain, op.timestamp)
        )
      }
    }
  }
}
