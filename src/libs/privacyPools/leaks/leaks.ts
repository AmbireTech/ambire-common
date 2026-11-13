import {
  PrivacyPoolsDepositPrivacy,
  PrivacyPoolsLeak,
  PrivacyPoolsNote,
  PrivacyPoolsRating,
  PrivacyPoolsSendCover,
  PrivacyPoolsWithdrawalPrivacy
} from '../../../interfaces/privacyPools'
import {
  countPrivacyPoolsDepositsOfAtLeast,
  getRecentPrivacyPoolsDeposits,
  PrivacyPoolsPoolCover
} from '../poolStats'
import { getPrivacyPoolsNotesToSpend, getSendCover, getSendPoolCover } from './helpers'
import { DEPOSIT_LEAKS, WITHDRAWAL_LEAKS } from './rules'
import { CommonAmountCover, LeakRule, WithdrawalFacts } from './types'

const NO_COVER: PrivacyPoolsSendCover = { bigEnough: 0, sameAmount: 0 }

/**
 * The privacy of a send of `notesCount` deposits that could not be checked, with no leaks and no
 * cover. The user is asked to confirm it, as anything in it could link it to them.
 */
export const getUncheckedPrivacyPoolsWithdrawalPrivacy = (
  notesCount: number,
  /** See `PrivacyPoolsWithdrawalPrivacy.isFingerprintedCover`. */
  isFingerprintedCover: boolean
): PrivacyPoolsWithdrawalPrivacy => ({
  rating: 'unchecked',
  leaks: [],
  cover: NO_COVER,
  notesCount,
  isFingerprintedCover
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
 * missing pool cover gives.
 */
const getRating = (leaks: PrivacyPoolsLeak[]): PrivacyPoolsRating => {
  if (leaks.some(({ type }) => type === 'error')) return 'traceable'
  if (leaks.some(({ type }) => type === 'warning')) return 'weak'

  return 'standard'
}

/**
 * How many deposits would hide a send of each common amount the notes can pay. Each is counted
 * against the deposits its own spends hide among, and left out when those are not read yet.
 */
const getCommonAmountCovers = (
  notes: PrivacyPoolsNote[],
  tokenAddress: string,
  commonAmounts: bigint[],
  poolCover: PrivacyPoolsPoolCover | null,
  fingerprints: ReadonlyMap<string, boolean> | null
): CommonAmountCover[] =>
  commonAmounts.flatMap((commonAmount) => {
    const commonAmountSpends = getPrivacyPoolsNotesToSpend(notes, tokenAddress, commonAmount)
    if (!commonAmountSpends) return []

    const sendPoolCover = getSendPoolCover(commonAmountSpends, notes, poolCover, fingerprints)
    if (!sendPoolCover.poolCover) return []

    return [
      { amount: commonAmount, cover: getSendCover(sendPoolCover.poolCover, commonAmountSpends) }
    ]
  })

/**
 * The privacy of a send of `amount` of a token from the account's notes. Rated `unchecked`, with no
 * leaks and no cover, until the deposits it hides among are read - see `getSendPoolCover`. An
 * `amount` of 0 means none is entered yet, so only the recipient is checked and there is no cover.
 * Null when the notes cannot pay `amount`, or it is negative.
 */
export const getPrivacyPoolsWithdrawalPrivacy = ({
  amount,
  commonAmounts,
  poolCover,
  fingerprints,
  ...params
}: {
  amount: bigint
  /** The account's notes on the chain, in the order the SDK lists them. */
  notes: PrivacyPoolsNote[]
  tokenAddress: string
  /** Null before the user enters one, so only the amount is checked. */
  recipient: string | null
  /** Null before the pool's deposits are read. */
  poolCover: PrivacyPoolsPoolCover | null
  /** See `getSendPoolCover`. */
  fingerprints: ReadonlyMap<string, boolean> | null
  /** The pool's common amounts, smallest first - see `PRIVACY_POOLS_DEPOSIT_CHIPS`. */
  commonAmounts: bigint[]
}): PrivacyPoolsWithdrawalPrivacy | null => {
  const { notes, tokenAddress } = params
  // No amount is entered yet, so only the recipient can be checked
  const isRecipientOnly = amount === 0n
  const spends = isRecipientOnly ? [] : getPrivacyPoolsNotesToSpend(notes, tokenAddress, amount)
  if (!spends) return null

  const sendPoolCover = getSendPoolCover(spends, notes, poolCover, fingerprints)
  const { isFingerprintedCover } = sendPoolCover
  if (!sendPoolCover.poolCover)
    return getUncheckedPrivacyPoolsWithdrawalPrivacy(spends.length, isFingerprintedCover)

  const facts: WithdrawalFacts = {
    ...params,
    poolCover: sendPoolCover.poolCover,
    amount,
    spends,
    // `getSendCover` takes the smallest count over the spends, which is Infinity with none
    cover: isRecipientOnly ? NO_COVER : getSendCover(sendPoolCover.poolCover, spends),
    // Common amounts are only suggested in place of an entered amount
    commonAmountCovers: isRecipientOnly
      ? []
      : getCommonAmountCovers(notes, tokenAddress, commonAmounts, poolCover, fingerprints)
  }
  const leaks = findLeaks(WITHDRAWAL_LEAKS, facts)

  return {
    rating: getRating(leaks),
    leaks,
    cover: facts.cover,
    notesCount: spends.length,
    isFingerprintedCover
  }
}

/**
 * The privacy of a deposit that puts `amount` into a pool, after the vetting fee. Counted against
 * all of the pool's deposits, as how the user sends it later is not chosen yet. Rated `unchecked`,
 * with no leaks, without the pool's deposits.
 */
export const getPrivacyPoolsDepositPrivacy = ({
  amount,
  maxAmount,
  poolCover,
  commonAmounts
}: {
  amount: bigint
  /** The most the balance can put into the pool, after the vetting fee. */
  maxAmount: bigint
  /** Null before the pool's deposits are read. */
  poolCover: PrivacyPoolsPoolCover | null
  /** The pool's common amounts, smallest first - see `PRIVACY_POOLS_DEPOSIT_CHIPS`. */
  commonAmounts: bigint[]
}): Omit<PrivacyPoolsDepositPrivacy, 'isLoading'> => {
  if (!poolCover) return { rating: 'unchecked', leaks: [], bigEnough: 0 }

  // Sending all of it at once later is its least private send, so count for that send
  const bigEnough = countPrivacyPoolsDepositsOfAtLeast(
    getRecentPrivacyPoolsDeposits(poolCover),
    amount
  )
  // No amount yet, so there is nothing to warn about
  const leaks =
    amount > 0n ? findLeaks(DEPOSIT_LEAKS, { amount, maxAmount, poolCover, commonAmounts }) : []

  return { rating: getRating(leaks), leaks, bigEnough }
}
