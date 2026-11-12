import {
  PrivacyPoolsLeakAction,
  PrivacyPoolsNote,
  PrivacyPoolsSendCover
} from '../../../interfaces/privacyPools'
import { findSendablePrivacyPoolsNote, isPrivacyPoolsNoteOfToken } from '../notes'
import {
  countPrivacyPoolsDepositsOf,
  countPrivacyPoolsDepositsOfAtLeast,
  PrivacyPoolsDepositIndex
} from '../poolStats'
import { OwnDepositValues, PrivacyPoolsNoteSpend } from './types'

/**
 * What a send of `amount` spends: part or all of the approved deposit with `noteLabel`, as one send
 * spends one deposit. Null when that deposit cannot pay `amount`, or it is not positive.
 */
export const getPrivacyPoolsNoteSpends = (
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  noteLabel: bigint,
  amount: bigint
): PrivacyPoolsNoteSpend[] | null => {
  const note = findSendablePrivacyPoolsNote(notes, tokenAddress, noteLabel, amount)

  return note ? [{ note, amount }] : null
}

/** The approved deposits of the account's notes of the token, as the deposit index counts them. */
export const getOwnDepositValues = (
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  { recentAfterBlock }: PrivacyPoolsDepositIndex
): OwnDepositValues => {
  const ownDeposits = notes.filter(
    (note) => isPrivacyPoolsNoteOfToken(note, tokenAddress) && note.approval === 'approved'
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
