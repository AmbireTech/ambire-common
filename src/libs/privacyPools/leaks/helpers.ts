import {
  PrivacyPoolsLeakAction,
  PrivacyPoolsNote,
  PrivacyPoolsSendCover
} from '../../../interfaces/privacyPools'
import {
  countPrivacyPoolsDepositsOf,
  countPrivacyPoolsDepositsOfAtLeast,
  PrivacyPoolsDepositIndex
} from '../poolStats'
import { OwnDepositValues, PrivacyPoolsNoteSpend } from './types'

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

/** The approved deposits of the account's notes of the token, as the deposit index counts them. */
export const getOwnDepositValues = (
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  { recentAfterBlock }: PrivacyPoolsDepositIndex
): OwnDepositValues => {
  const ownDeposits = notes.filter(
    (note) => isNoteOfToken(note, tokenAddress) && note.approval === 'approved'
  )

  return {
    all: ownDeposits.map(({ depositValue }) => depositValue),
    recent: ownDeposits
      .filter(({ blockNumber }) => blockNumber > recentAfterBlock)
      .map(({ depositValue }) => depositValue)
  }
}

/** How many of `counted` deposits are not one of the user's `ownValues`. */
export const countOthers = (
  counted: number,
  ownValues: bigint[],
  isCounted: (value: bigint) => boolean
) =>
  // Never below 0, as the notes can be newer than the deposit index
  Math.max(counted - ownValues.filter(isCounted).length, 0)

/** How many recent deposits of others hide a send that spends `spends`. */
export const getSendCover = (
  { recent }: PrivacyPoolsDepositIndex,
  ownDepositValues: OwnDepositValues,
  spends: PrivacyPoolsNoteSpend[]
): PrivacyPoolsSendCover => ({
  bigEnough: Math.min(
    ...spends.map(({ amount }) =>
      countOthers(
        countPrivacyPoolsDepositsOfAtLeast(recent, amount),
        ownDepositValues.recent,
        (value) => value >= amount
      )
    )
  ),
  sameAmount: Math.min(
    ...spends.map(({ amount }) =>
      countOthers(
        countPrivacyPoolsDepositsOf(recent, amount),
        ownDepositValues.recent,
        (value) => value === amount
      )
    )
  )
})

/**
 * The closest of `candidates` (smallest first) that `isValid` accepts and is not above `amount`,
 * else the closest above it. Undefined when none is valid.
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
