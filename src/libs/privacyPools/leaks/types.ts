import {
  PrivacyPoolsLeak,
  PrivacyPoolsLeakAction,
  PrivacyPoolsNote,
  PrivacyPoolsSendCover
} from '../../../interfaces/privacyPools'
import { PrivacyPoolsDepositIndex } from '../poolStats'

/** The part of a send paid from one note. */
export type PrivacyPoolsNoteSpend = { note: PrivacyPoolsNote; amount: bigint }

/** A common amount the notes can pay, with how many deposits would hide a send of it. */
export type CommonAmountCover = { amount: bigint; cover: PrivacyPoolsSendCover }

/**
 * What the account's own deposits put into the pool, of all time and recent ones. They hide
 * nobody, as they all point to the user.
 */
export type OwnDepositValues = { all: bigint[]; recent: bigint[] }

export type WithdrawalFacts = {
  amount: bigint
  notes: PrivacyPoolsNote[]
  tokenAddress: string
  spends: PrivacyPoolsNoteSpend[]
  cover: PrivacyPoolsSendCover
  commonAmountCovers: CommonAmountCover[]
  recipient: string | null
  isOwnAccount: boolean
  /** Whether the own account was used on the send's network. Null when not checked. */
  isRecipientUsed: boolean | null
  recipientHasEth: boolean | null
  depositIndex: PrivacyPoolsDepositIndex
  ownDepositValues: OwnDepositValues
}

export type DepositFacts = {
  amount: bigint
  maxAmount: bigint
  sameAmount: number
  depositIndex: PrivacyPoolsDepositIndex
  commonAmounts: bigint[]
}

/**
 * A leak the user can have, with the copy they see, and when it applies. The actions are built
 * from the facts, so the rule has `getActions` instead of `actions`.
 */
export type LeakRule<Facts> = Omit<PrivacyPoolsLeak, 'actions'> & {
  applies: (facts: Facts) => boolean
  getActions?: (facts: Facts) => PrivacyPoolsLeakAction[]
}
