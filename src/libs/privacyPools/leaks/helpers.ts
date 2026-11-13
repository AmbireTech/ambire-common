import {
  PrivacyPoolsLeakAction,
  PrivacyPoolsNote,
  PrivacyPoolsSendCover
} from '../../../interfaces/privacyPools'
import {
  countPrivacyPoolsDepositsOf,
  countPrivacyPoolsDepositsOfAtLeast,
  getRecentPrivacyPoolsDeposits,
  PrivacyPoolsPoolCover
} from '../poolStats'
import { PrivacyPoolsNoteSpend } from './types'

/** Whether the note is of the token, whatever the casing of the addresses. */
const isNoteOfToken = (note: PrivacyPoolsNote, tokenAddress: string) =>
  note.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()

/**
 * The notes of a token a send can spend, in the order the SDK spends them: approved ones with a
 * balance, largest first, ties in the order the SDK lists them.
 */
const getSpendableNotes = (notes: PrivacyPoolsNote[], tokenAddress: string) =>
  notes
    .filter(
      (note) =>
        isNoteOfToken(note, tokenAddress) && note.approval === 'approved' && note.amount > 0n
    )
    // Stable, so ties keep the SDK's order
    .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0))

/**
 * The notes the SDK spends for a send of `amount`, as its `getNotesToSpendSelector` picks them
 * (it does not export it). Null when they cannot pay `amount`, or it is not positive.
 */
export const getPrivacyPoolsNotesToSpend = (
  /** In the order the SDK lists them, as the sync keeps them. */
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  amount: bigint
): PrivacyPoolsNoteSpend[] | null => {
  if (amount <= 0n) return null

  const spends: PrivacyPoolsNoteSpend[] = []
  let remaining = amount
  for (const note of getSpendableNotes(notes, tokenAddress)) {
    if (remaining <= 0n) break

    const spentAmount = note.amount < remaining ? note.amount : remaining
    spends.push({ note, amount: spentAmount })
    remaining -= spentAmount
  }

  return remaining > 0n ? null : spends
}

/**
 * The deposits of other people that a send of `spends` can hide among. The user's own deposits are
 * left out, as they all lead back to the user.
 *
 * When one of the spent deposits has a Kohaku client fingerprint, the send hides only among other
 * deposits that have one. Until a depositor is checked, the user's deposit counts as having the
 * fingerprint and someone else's does not, so the result is never larger than the real one.
 *
 * Null before the pool's deposits are read. Also null when the send must hide among fingerprinted
 * deposits and no depositor of the chain is checked yet.
 */
export const getSendPoolCover = (
  spends: PrivacyPoolsNoteSpend[],
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
  const isFingerprintedCover = spends.some(
    ({ note }) => fingerprints?.get(note.depositorAddr.toLowerCase()) !== false
  )
  if (!poolCover || (isFingerprintedCover && !fingerprints)) return null

  const ownLabels = new Set(notes.map(({ label }) => label))
  const deposits = poolCover.deposits.filter(
    ({ label, depositor }) =>
      !ownLabels.has(label) && (!isFingerprintedCover || fingerprints?.get(depositor) === true)
  )

  return { ...poolCover, deposits }
}

/** How many recent deposits of `poolCover` hide a send that spends `spends`. */
export const getSendCover = (
  poolCover: PrivacyPoolsPoolCover,
  spends: PrivacyPoolsNoteSpend[]
): PrivacyPoolsSendCover => {
  const recentDeposits = getRecentPrivacyPoolsDeposits(poolCover)

  return {
    bigEnough: Math.min(
      ...spends.map(({ amount }) => countPrivacyPoolsDepositsOfAtLeast(recentDeposits, amount))
    ),
    sameAmount: Math.min(
      ...spends.map(({ amount }) => countPrivacyPoolsDepositsOf(recentDeposits, amount))
    )
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
