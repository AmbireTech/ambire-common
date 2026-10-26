import { SubmittedAccountOpLike } from '../accountOp/submittedAccountOp'
import { AccountOpStatus } from '../accountOp/types'

/** Statuses of an account op that got onchain, so it's the one that replaced the others */
const PROCESSED_STATUSES = [AccountOpStatus.Success, AccountOpStatus.Failure]

const isProcessed = ({ status }: SubmittedAccountOpLike) =>
  !!status && PROCESSED_STATUSES.includes(status)

/**
 * Account ops sent by the same EOA with the same nonce replace each other (e.g. a speed up),
 * so only one of them can end up onchain. Returns the key they share, or null for ops that
 * can't be replaced this way (e.g. broadcast by a relayer or a bundler, which set no eoaNonce).
 *
 * eoaNonce is the nonce of the EOA that paid for the broadcast (paidBy), which may differ from
 * the account itself (e.g. a smart account paid by one of its EOA keys). Nonces of different
 * EOAs are unrelated, so the payer is part of the key too
 */
export const getReplacementKey = (
  accountOp: Pick<SubmittedAccountOpLike, 'chainId' | 'gasFeePayment' | 'eoaNonce'>
): string | null => {
  const paidBy = accountOp.gasFeePayment?.paidBy?.toLowerCase()
  if (accountOp.eoaNonce === null || accountOp.eoaNonce === undefined || !paidBy) return null

  return `${accountOp.chainId.toString()}:${paidBy}:${accountOp.eoaNonce.toString()}`
}

const isBetterRepresentative = (
  candidate: SubmittedAccountOpLike,
  current: SubmittedAccountOpLike
): boolean => {
  const isCandidateProcessed = isProcessed(candidate)
  const isCurrentProcessed = isProcessed(current)
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

/**
 * Finds `accountOp` in a list collapsed by collapseReplacedAccountOps. Once it's sped up, only
 * one op of its group is in the list, so the op shown in its place is returned instead: the one
 * that got (or will get) onchain. Ops that can't be replaced are matched by their signature
 */
export const findAccountOpOrReplacement = <T extends SubmittedAccountOpLike>(
  accountOps: T[],
  accountOp: Pick<SubmittedAccountOpLike, 'chainId' | 'gasFeePayment' | 'eoaNonce' | 'signature'>
): T | undefined => {
  const replacementKey = getReplacementKey(accountOp)
  if (replacementKey) return accountOps.find((op) => getReplacementKey(op) === replacementKey)

  if (!accountOp.signature) return undefined

  return accountOps.find((op) => op.signature === accountOp.signature)
}
