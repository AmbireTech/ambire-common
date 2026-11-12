import {
  PrivacyPoolsDepositPrivacy,
  PrivacyPoolsLeak,
  PrivacyPoolsNote,
  PrivacyPoolsRating,
  PrivacyPoolsSendCover,
  PrivacyPoolsWithdrawalPrivacy
} from '../../../interfaces/privacyPools'
import { countPrivacyPoolsDepositsOf, PrivacyPoolsDepositIndex } from '../poolStats'
import { getOwnDepositValues, getPrivacyPoolsNotesToSpend, getSendCover } from './helpers'
import { DEPOSIT_LEAKS, WITHDRAWAL_LEAKS } from './rules'
import { LeakRule, WithdrawalFacts } from './types'

const NO_COVER: PrivacyPoolsSendCover = { bigEnough: 0, sameAmount: 0 }

/**
 * The privacy of a send of `notesCount` deposits that could not be checked, with no leaks and no
 * cover. The user is asked to confirm it, as anything in it could link it to them.
 */
export const getUncheckedPrivacyPoolsWithdrawalPrivacy = (
  notesCount: number
): PrivacyPoolsWithdrawalPrivacy => ({
  rating: 'unchecked',
  leaks: [],
  cover: NO_COVER,
  notesCount
})

/** The leaks the facts have, in the order of `rules`. */
const findLeaks = <Facts>(rules: LeakRule<Facts>[], facts: Facts): PrivacyPoolsLeak[] =>
  rules
    .filter((rule) => rule.applies(facts))
    .map(({ id, type, title, text, getActions }) => ({
      id,
      type,
      title,
      text,
      actions: getActions?.(facts) ?? []
    }))

/**
 * The worst leak sets the rating, and info leaks do not count. With no leaks it is `standard`, and
 * the cover shown to the user tells how well the send hides. Never `unchecked`, which only a
 * missing deposit index gives.
 */
const getRating = (leaks: PrivacyPoolsLeak[]): PrivacyPoolsRating => {
  if (leaks.some(({ type }) => type === 'error')) return 'traceable'
  if (leaks.some(({ type }) => type === 'warning')) return 'weak'

  return 'standard'
}

/**
 * The privacy of a send of `amount` of a token from the account's notes. Rated `unchecked`, with no
 * leaks and no cover, until the pool's deposits are read. An `amount` of 0 means none is entered
 * yet, so only the recipient is checked and there is no cover. Null when the notes cannot pay
 * `amount`, or it is negative.
 */
export const getPrivacyPoolsWithdrawalPrivacy = ({
  amount,
  commonAmounts,
  ...params
}: {
  amount: bigint
  /** The account's notes on the chain, in the order the SDK lists them. */
  notes: PrivacyPoolsNote[]
  tokenAddress: string
  /** Null before the user enters one, so only the amount is checked. */
  recipient: string | null
  /** Null before the pool's deposits are read. */
  depositIndex: PrivacyPoolsDepositIndex | null
  /** The pool's common amounts, smallest first - see `PRIVACY_POOLS_DEPOSIT_CHIPS`. */
  commonAmounts: bigint[]
}): PrivacyPoolsWithdrawalPrivacy | null => {
  const { notes, tokenAddress, depositIndex } = params
  // No amount is entered yet, so only the recipient can be checked
  const isRecipientOnly = amount === 0n
  const spends = isRecipientOnly ? [] : getPrivacyPoolsNotesToSpend(notes, tokenAddress, amount)
  if (!spends) return null

  if (!depositIndex) return getUncheckedPrivacyPoolsWithdrawalPrivacy(spends.length)

  const ownDepositValues = getOwnDepositValues(notes, tokenAddress, depositIndex)
  // Common amounts are only suggested in place of an entered amount
  const commonAmountCovers = isRecipientOnly
    ? []
    : commonAmounts.flatMap((commonAmount) => {
        const commonAmountSpends = getPrivacyPoolsNotesToSpend(notes, tokenAddress, commonAmount)
        if (!commonAmountSpends) return []

        return [
          {
            amount: commonAmount,
            cover: getSendCover(depositIndex, ownDepositValues, commonAmountSpends)
          }
        ]
      })
  const facts: WithdrawalFacts = {
    ...params,
    depositIndex,
    ownDepositValues,
    amount,
    spends,
    // `getSendCover` takes the smallest count over the spends, which is Infinity with none
    cover: isRecipientOnly ? NO_COVER : getSendCover(depositIndex, ownDepositValues, spends),
    commonAmountCovers
  }
  const leaks = findLeaks(WITHDRAWAL_LEAKS, facts)

  return { rating: getRating(leaks), leaks, cover: facts.cover, notesCount: spends.length }
}

/**
 * The privacy of a deposit that puts `amount` into a pool, after the vetting fee. Rated
 * `unchecked`, with no leaks, without the pool's deposits.
 */
export const getPrivacyPoolsDepositPrivacy = ({
  amount,
  maxAmount,
  depositIndex,
  commonAmounts
}: {
  amount: bigint
  /** The most the balance can put into the pool, after the vetting fee. */
  maxAmount: bigint
  /** Null before the pool's deposits are read. */
  depositIndex: PrivacyPoolsDepositIndex | null
  /** The pool's common amounts, smallest first - see `PRIVACY_POOLS_DEPOSIT_CHIPS`. */
  commonAmounts: bigint[]
}): PrivacyPoolsDepositPrivacy => {
  if (!depositIndex) return { rating: 'unchecked', leaks: [], sameAmount: 0 }

  const sameAmount = countPrivacyPoolsDepositsOf(depositIndex.recent, amount)
  // No amount yet, so there is nothing to warn about
  const leaks =
    amount > 0n ? findLeaks(DEPOSIT_LEAKS, { amount, maxAmount, depositIndex, commonAmounts }) : []

  return { rating: getRating(leaks), leaks, sameAmount }
}
