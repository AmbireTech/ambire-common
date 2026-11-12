import { PrivacyPoolsNote } from '../../interfaces/privacyPools'

/** Whether the note is of the token, whatever the casing of the addresses. */
export const isPrivacyPoolsNoteOfToken = (note: PrivacyPoolsNote, tokenAddress: string) =>
  note.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()

/**
 * The deposit with `label` a send of `amount` of the token can spend: an approved one with that
 * much left. Undefined when there is none, or `amount` is not positive.
 */
export const findSendablePrivacyPoolsNote = (
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  label: bigint,
  amount: bigint
): PrivacyPoolsNote | undefined => {
  if (amount <= 0n) return undefined

  return notes.find(
    (note) =>
      note.label === label &&
      isPrivacyPoolsNoteOfToken(note, tokenAddress) &&
      note.approval === 'approved' &&
      note.amount >= amount
  )
}

/**
 * The deposit the SDK spends for a send of `amount`, as its `getNoteSelector` picks it (it does not
 * export it): the one with the least left that covers `amount`, pending ones too, ties in the order
 * the SDK lists them. Undefined when none covers it.
 *
 * TODO: delete once the SDK takes the deposit to spend, and pass it the chosen one instead.
 */
export const getSdkPickedPrivacyPoolsNote = (
  /** In the order the SDK lists them, as the sync keeps them. */
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  amount: bigint
): PrivacyPoolsNote | undefined =>
  notes
    .filter((note) => isPrivacyPoolsNoteOfToken(note, tokenAddress) && note.amount >= amount)
    // Stable, so ties keep the SDK's order
    .sort((a, b) => {
      if (a.amount === b.amount) return 0

      return a.amount < b.amount ? -1 : 1
    })[0]
