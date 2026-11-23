import { countPrivacyPoolsDepositsOf, getPrivacyPoolsCoverWindowDeposits } from '../poolStats'
import { findNearest, setAmountAction } from './helpers'
import { DepositFacts, LeakRule, PrivacyPoolsNoteSpend, WithdrawalFacts } from './types'

const COMMON_AMOUNT_LABEL = 'Use a common amount'
const WHOLE_DEPOSIT_LABEL = 'Send the whole deposit'

/** The common amount nearest to the send's that more than `least` deposits have exactly. */
const findBetterCommonAmount = ({ amount, commonAmountCovers }: WithdrawalFacts, least: number) =>
  findNearest(
    amount,
    commonAmountCovers,
    (commonAmountCover) => commonAmountCover.amount,
    (commonAmountCover) => commonAmountCover.cover.sameAmount > least
  )

/** The spend, when it goes back to the address its deposit was made from. */
const getSpendToDepositor = ({
  spend,
  recipient
}: WithdrawalFacts): PrivacyPoolsNoteSpend | null => {
  if (!spend || !recipient) return null

  return spend.note.depositorAddr.toLowerCase() === recipient.toLowerCase() ? spend : null
}

/** Part of a deposit no send has touched goes back, so its rest can be matched to later sends. */
const isPartOfUnsentDepositToDepositor = (facts: WithdrawalFacts) => {
  const spend = getSpendToDepositor(facts)

  return !!spend && spend.note.withdrawCount === 0 && spend.amount < spend.note.amount
}

/** Any of a deposit that earlier sends took part of goes back, which links those sends to it. */
const isPartlySentDepositToDepositor = (facts: WithdrawalFacts) =>
  (getSpendToDepositor(facts)?.note.withdrawCount ?? 0) > 0

/**
 * The leaks a send can have. Written worst first (error, warning, info), which is the order the
 * user sees them in.
 */
export const WITHDRAWAL_LEAKS: LeakRule<WithdrawalFacts>[] = [
  {
    id: 'unique-amount',
    type: 'error',
    title: 'Your unique deposit amount makes this send traceable',
    text: 'Anyone can match this send to your deposit by its unique amount, linking the recipient to your original deposit address. Send a more common amount to make this connection harder to trace.',
    // Counts all deposits, not only the cover window's, as an older deposit of the same amount by
    // someone else still hides this one
    applies: ({ spend, poolCover }) =>
      !!spend &&
      spend.amount === spend.note.depositValue &&
      countPrivacyPoolsDepositsOf(poolCover.deposits, spend.amount) === 0,
    getActions: (facts) => {
      const commonAmountCover = findBetterCommonAmount(facts, facts.cover.sameAmount)
      if (!commonAmountCover) return []

      return [setAmountAction(commonAmountCover.amount, COMMON_AMOUNT_LABEL)]
    }
  },
  // Warnings, as the rest of the deposit and the other sends can still hide behind common amounts
  {
    id: 'send-to-depositor',
    type: 'warning',
    title: 'Sending part of your deposit back makes the rest easier to trace',
    text: 'Anyone can link this address to your original deposit, making it easier to trace the remaining funds to other recipients, especially if the amounts are unusual. Send the full deposit back or choose a different recipient.',
    applies: isPartOfUnsentDepositToDepositor,
    // All of a deposit no send has touched leaves nothing to match later sends to
    getActions: ({ spend }) =>
      spend ? [setAmountAction(spend.note.amount, WHOLE_DEPOSIT_LABEL)] : []
  },
  // No amount fixes it, as the part sent earlier can't be sent back whole
  {
    id: 'send-rest-to-depositor',
    type: 'warning',
    title: 'Sending here may link your earlier sends to your original address',
    text: 'Anyone can see this address made the deposit. Part of it was already sent elsewhere, so sending more of it here can help match those sends to you, mostly when their amounts are unusual. Send to a different address.',
    applies: isPartlySentDepositToDepositor
  },
  // No amount fixes it either, as sending less only leaves a rest that does the same later
  {
    id: 'empties-partly-sent-deposit',
    type: 'warning',
    title: 'Consider sending the rest later',
    text: 'This send uses the rest of your deposit. Combined with your earlier sends, the amounts add up to your exact deposit, making it easier to link them together. Waiting until more people use the pool can make this connection harder to trace.',
    applies: ({ spend }) =>
      !!spend && spend.note.withdrawCount > 0 && spend.amount === spend.note.amount
  },
  {
    id: 'fresh-deposit',
    type: 'warning',
    title: 'This deposit is less than a day old, making it easier to link to you',
    text: 'Anyone can see when you deposited and when you send. Sending shortly after depositing makes it easier to link the two. Wait at least a day to let more deposits enter the pool, making yours harder to identify.',
    applies: ({ spend, poolCover }) => !!spend && spend.note.blockNumber > poolCover.dayAgoBlock
  }
]

/**
 * The leaks a deposit can have. Written worst first (error, warning, info), which is the order the
 * user sees them in.
 */
export const DEPOSIT_LEAKS: LeakRule<DepositFacts>[] = [
  {
    id: 'unusual-deposit-amount',
    type: 'info',
    title: 'No one else has deposited this amount, so it stands out',
    text: 'You can still send it privately, but sending the full amount at once could link the recipient to your deposit. Using a more common amount reduces this risk.',
    // Counts all deposits, not only the cover window's, the same as `unique-amount` does for the send
    applies: ({ amount, poolCover }) =>
      countPrivacyPoolsDepositsOf(poolCover.deposits, amount) === 0,
    getActions: ({ amount, maxAmount, poolCover, commonAmounts }) => {
      const coverWindowDeposits = getPrivacyPoolsCoverWindowDeposits(poolCover)
      const commonAmount = findNearest(
        amount,
        commonAmounts,
        (candidate) => candidate,
        (candidate) =>
          candidate <= maxAmount && countPrivacyPoolsDepositsOf(coverWindowDeposits, candidate) > 0
      )
      if (commonAmount === undefined) return []

      return [setAmountAction(commonAmount, COMMON_AMOUNT_LABEL)]
    }
  }
]
