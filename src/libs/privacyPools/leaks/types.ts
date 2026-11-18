import {
  PrivacyPoolsLeak,
  PrivacyPoolsLeakAction,
  PrivacyPoolsNote,
  PrivacyPoolsSendCover
} from '../../../interfaces/privacyPools'
import { PrivacyPoolsPoolCover } from '../poolStats'

/** The part of a send paid from one note. */
export type PrivacyPoolsNoteSpend = { note: PrivacyPoolsNote; amount: bigint }

/** A common amount the notes can pay, with how many deposits would hide a send of it. */
export type CommonAmountCover = { amount: bigint; cover: PrivacyPoolsSendCover }

export type WithdrawalFacts = {
  amount: bigint
  notes: PrivacyPoolsNote[]
  tokenAddress: string
  spends: PrivacyPoolsNoteSpend[]
  cover: PrivacyPoolsSendCover
  commonAmountCovers: CommonAmountCover[]
  recipient: string | null
  /** The deposits of others that hide the send - see `getSendPoolCover`. */
  poolCover: PrivacyPoolsPoolCover
}

export type DepositFacts = {
  amount: bigint
  maxAmount: bigint
  poolCover: PrivacyPoolsPoolCover
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
