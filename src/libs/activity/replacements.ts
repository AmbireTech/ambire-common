import { SubmittedAccountOpLike } from '../accountOp/submittedAccountOp'
import { AccountOpStatus } from '../accountOp/types'

/** Statuses of an account op that got onchain, so it's the one that replaced the others */
const PROCESSED_STATUSES = [AccountOpStatus.Success, AccountOpStatus.Failure]

/**
 * Account ops sent by the same EOA with the same nonce replace each other (e.g. a speed up),
 * so only one of them can end up onchain. Returns the key they share, or null for ops that
 * can't be replaced this way (e.g. broadcast by a relayer or a bundler, which set no eoaNonce).
 *
 * eoaNonce is the nonce of the EOA that paid for the broadcast (paidBy), which may differ from
 * the account itself (e.g. a smart account paid by one of its EOA keys). Nonces of different
 * EOAs are unrelated, so the payer is part of the key too
 */
export const getReplacementKey = (accountOp: SubmittedAccountOpLike): string | null => {
  const paidBy = accountOp.gasFeePayment?.paidBy?.toLowerCase()
  if (accountOp.eoaNonce === null || accountOp.eoaNonce === undefined || !paidBy) return null

  return `${accountOp.chainId.toString()}:${paidBy}:${accountOp.eoaNonce.toString()}`
}

const isBetterRepresentative = (
  candidate: SubmittedAccountOpLike,
  current: SubmittedAccountOpLike
): boolean => {
  const isCandidateProcessed = PROCESSED_STATUSES.includes(candidate.status)
  const isCurrentProcessed = PROCESSED_STATUSES.includes(current.status)
  if (isCandidateProcessed !== isCurrentProcessed) return isCandidateProcessed

  return candidate.timestamp > current.timestamp
}

/**
 * Keeps one account op per group of ops that replace each other (see getReplacementKey):
 * the one that got onchain (confirmed or failed) or, while none has, the newest one, as it
 * pays the highest fee. The order of the ops is kept
 */
export const collapseReplacedAccountOps = <T extends SubmittedAccountOpLike>(
  accountOps: T[]
): T[] => {
  const representatives = new Map<string, T>()

  accountOps.forEach((accountOp) => {
    const key = getReplacementKey(accountOp)
    if (!key) return

    const current = representatives.get(key)
    if (!current || isBetterRepresentative(accountOp, current)) {
      representatives.set(key, accountOp)
    }
  })

  return accountOps.filter((accountOp) => {
    const key = getReplacementKey(accountOp)

    return !key || representatives.get(key) === accountOp
  })
}
