import { getPrivacyPoolsChainConfig } from '../../consts/privacyPools'
import { PrivacyPoolsNote, PrivacyPoolsSendableDeposit } from '../../interfaces/privacyPools'

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

/** The account's deposits of the token, oldest first, as `PrivacyPoolsSendableDeposit` numbers them. */
const getTokenNotesInDepositOrder = (notes: PrivacyPoolsNote[], tokenAddress: string) =>
  notes
    .filter((note) => isPrivacyPoolsNoteOfToken(note, tokenAddress))
    .sort((a, b) => a.depositIndex - b.depositIndex)

/**
 * The label of the account's deposit of the token with `number` - see
 * `PrivacyPoolsSendableDeposit.number`. Undefined when there is none.
 */
export const findPrivacyPoolsDepositLabel = (
  /** All of the account's notes on the chain, the spent ones too. */
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  number: number
): bigint | undefined => getTokenNotesInDepositOrder(notes, tokenAddress)[number - 1]?.label

/**
 * The deposits a send can spend on a chain: approved ones, of a token that can be sent, with
 * something left once the sends on their way are taken out. In the order of the chain's assets,
 * then oldest first. Each is numbered among all of the account's deposits of its token, the spent
 * and pending ones too, so its number stays as others arrive or are sent in full.
 */
export const getPrivacyPoolsSendableDeposits = ({
  chainId,
  notes,
  withdrawingAmounts
}: {
  chainId: string
  /** All of the account's notes on the chain, the spent ones too. */
  notes: PrivacyPoolsNote[]
  /** Per deposit label, what sends on their way take out of it. */
  withdrawingAmounts: Map<bigint, bigint>
}): PrivacyPoolsSendableDeposit[] =>
  (getPrivacyPoolsChainConfig(BigInt(chainId))?.assets || [])
    .filter(({ isWithdrawable }) => isWithdrawable)
    .flatMap((asset) =>
      getTokenNotesInDepositOrder(notes, asset.address).flatMap((note, index) => {
        const availableAmount = note.amount - (withdrawingAmounts.get(note.label) ?? 0n)
        if (note.approval !== 'approved' || availableAmount <= 0n) return []

        return [
          {
            // Lowercase, as `balances` has it
            tokenAddress: asset.address.toLowerCase(),
            symbol: asset.symbol,
            decimals: asset.decimals,
            isNative: asset.isNative,
            number: index + 1,
            availableAmount
          }
        ]
      })
    )
