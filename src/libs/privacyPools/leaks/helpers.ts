import {
  PrivacyPoolsLeakAction,
  PrivacyPoolsNote,
  PrivacyPoolsSendCover
} from '../../../interfaces/privacyPools'
import { findSendablePrivacyPoolsNote } from '../notes'
import {
  countPrivacyPoolsDepositsOf,
  countPrivacyPoolsDepositsOfAtLeast,
  getPrivacyPoolsCoverWindowDeposits,
  PrivacyPoolsPoolCover
} from '../poolStats'
import { PrivacyPoolsNoteSpend } from './types'

/**
 * What a send of `amount` spends: part or all of the approved deposit with `noteLabel`, as one send
 * spends one deposit. Null when that deposit cannot pay `amount`, or it is not positive.
 */
export const getPrivacyPoolsNoteSpend = (
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  noteLabel: bigint,
  amount: bigint
): PrivacyPoolsNoteSpend | null => {
  const note = findSendablePrivacyPoolsNote(notes, tokenAddress, noteLabel, amount)

  return note ? { note, amount } : null
}

/**
 * The deposits of other people that a send from `spend`'s deposit can hide among. The user's own
 * deposits are left out, as they all lead back to the user.
 *
 * When the spent deposit has a Kohaku client fingerprint, the send hides only among other deposits
 * that have one. Until a depositor is checked, the user's deposit counts as having the fingerprint
 * and someone else's does not, so the result is never larger than the real one.
 *
 * Null before the pool's deposits are read. Also null when the send must hide among fingerprinted
 * deposits and no depositor of the chain is checked yet.
 */
export const getSendPoolCover = (
  /** Null before an amount is entered, so no deposit is spent yet. */
  spend: PrivacyPoolsNoteSpend | null,
  /** All the account's notes, as each is one of its own deposits. */
  notes: PrivacyPoolsNote[],
  /** Null before the pool's deposits are read. */
  poolCover: PrivacyPoolsPoolCover | null,
  /**
   * Whether each depositor has a Kohaku client fingerprint, by its address in lowercase. Null
   * before any depositor of the chain is checked.
   */
  fingerprints: ReadonlyMap<string, boolean> | null
): PrivacyPoolsPoolCover | null => {
  const isFingerprintedCover =
    !!spend && fingerprints?.get(spend.note.depositorAddr.toLowerCase()) !== false
  if (!poolCover || (isFingerprintedCover && !fingerprints)) return null

  const ownLabels = new Set(notes.map(({ label }) => label))
  const deposits = poolCover.deposits.filter(
    ({ label, depositor }) =>
      !ownLabels.has(label) && (!isFingerprintedCover || fingerprints?.get(depositor) === true)
  )

  return { ...poolCover, deposits }
}

/** How many deposits in the cover window of `poolCover` hide a send that spends `spend`. */
export const getSendCover = (
  poolCover: PrivacyPoolsPoolCover,
  { amount }: PrivacyPoolsNoteSpend
): PrivacyPoolsSendCover => {
  const coverWindowDeposits = getPrivacyPoolsCoverWindowDeposits(poolCover)

  return {
    bigEnough: countPrivacyPoolsDepositsOfAtLeast(coverWindowDeposits, amount),
    sameAmount: countPrivacyPoolsDepositsOf(coverWindowDeposits, amount)
  }
}

/**
 * The closest of `candidates` (smallest first) below `amount` that `isValid` accepts, else the
 * closest above it. A candidate equal to `amount` is never picked. Undefined when none is valid.
 */
export const findNearest = <Candidate>(
  amount: bigint,
  candidates: Candidate[],
  getAmount: (candidate: Candidate) => bigint,
  isValid: (candidate: Candidate) => boolean
): Candidate | undefined => {
  const lower = candidates.filter(
    (candidate) => getAmount(candidate) < amount && isValid(candidate)
  )
  if (lower.length) return lower[lower.length - 1]

  return candidates.find((candidate) => getAmount(candidate) > amount && isValid(candidate))
}

/** An action that fills the amount field with `amount`, shown to the user as `label`. */
export const setAmountAction = (amount: bigint, label: string): PrivacyPoolsLeakAction => ({
  actionName: 'set-amount',
  meta: { amount },
  label
})
