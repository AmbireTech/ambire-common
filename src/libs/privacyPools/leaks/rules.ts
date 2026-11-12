import { countPrivacyPoolsDepositsOf } from '../poolStats'
import { countOthers, findNearest, setAmountAction } from './helpers'
import { DepositFacts, LeakRule, PrivacyPoolsNoteSpend, WithdrawalFacts } from './types'

const COMMON_AMOUNT_LABEL = 'Use a common amount'

/** The common amount nearest to the send's that more than `least` deposits have exactly. */
const findBetterCommonAmount = ({ amount, commonAmountCovers }: WithdrawalFacts, least: number) =>
  findNearest(
    amount,
    commonAmountCovers,
    (commonAmountCover) => commonAmountCover.amount,
    (commonAmountCover) => commonAmountCover.cover.sameAmount > least
  )

const isToDepositor = ({ note }: PrivacyPoolsNoteSpend, recipient: string | null) =>
  !!recipient && note.depositorAddr.toLowerCase() === recipient.toLowerCase()

/**
 * Sending a whole deposit back that no send has touched is fine, as it leaves nothing to link
 * later. Anything else reveals that the deposit is still the depositor's.
 */
const isRevealingSendToDepositor = ({ spends, recipient }: WithdrawalFacts) =>
  spends.some(
    (spend) =>
      isToDepositor(spend, recipient) &&
      (spend.amount < spend.note.amount || spend.note.withdrawCount > 0)
  )

/**
 * The leaks a send can have. Written worst first (error, warning, info), which is the order the
 * user sees them in.
 */
export const WITHDRAWAL_LEAKS: LeakRule<WithdrawalFacts>[] = [
  {
    id: 'unique-amount',
    type: 'error',
    title: 'This amount matches only your deposit',
    text: 'Nobody else has deposited this amount. This transfer will be linked to the address you deposited from, and to everything that address did.',
    // Counts all deposits, not only recent ones, as an older deposit of the same amount by
    // someone else still hides this one
    applies: ({ spends, depositIndex, ownDepositValues }) =>
      spends.some(
        ({ note, amount }) =>
          amount === note.depositValue &&
          countOthers(
            countPrivacyPoolsDepositsOf(depositIndex, amount),
            ownDepositValues.all,
            (value) => value === amount
          ) === 0
      ),
    getActions: (facts) => {
      const commonAmountCover = findBetterCommonAmount(facts, facts.cover.sameAmount)
      if (!commonAmountCover) return []

      return [setAmountAction(commonAmountCover.amount, COMMON_AMOUNT_LABEL)]
    }
  },
  {
    id: 'send-to-depositor',
    type: 'error',
    title: 'This is the address you deposited from',
    text: 'Sending here shows the deposit is still yours. It also links this transfer and any earlier ones from this deposit to that address.',
    applies: isRevealingSendToDepositor
  },
  // TODO: bring these two back once each deposit shows as its own balance and the SDK keeps part
  // of each deposit it spends (`obfuscateAmounts`, kohaku#388). Until then the user can see
  // neither which deposits a send uses nor how much is left in them, and the only fix either rule
  // could offer is to send less than they need to.
  // {
  //   id: 'empties-partly-sent-deposit',
  //   type: 'warning',
  //   title: 'Consider sending the rest later',
  //   text: 'This transfer sends all that is left of your deposit. Together with your earlier transfers, it adds up to exactly what you deposited, so someone can tell they all came from that deposit. Waiting while more people use the pool makes this harder to see.',
  //   applies: ({ spends }) =>
  //     spends.some(({ note, amount }) => note.withdrawCount > 0 && amount === note.amount)
  // },
  // {
  //   id: 'several-deposits',
  //   type: 'warning',
  //   title: 'This transfer uses several deposits',
  //   text: 'This shows they all belong to the same person. If one of them is ever linked to you, all of them will be.',
  //   applies: ({ spends }) => spends.length > 1
  // },
  {
    id: 'fresh-deposit',
    type: 'warning',
    title: 'Consider waiting a day',
    text: 'Few people have deposited since you did, so sending now makes the timing easier to match.',
    applies: ({ spends, depositIndex }) =>
      spends.some(({ note }) => note.blockNumber > depositIndex.freshAfterBlock)
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
    title: 'Nobody else has deposited this amount',
    text: 'This is fine if you later send other amounts. Sending all of it in one transfer would link it to you.',
    applies: ({ sameAmount }) => sameAmount === 0,
    getActions: ({ amount, maxAmount, depositIndex, commonAmounts }) => {
      const commonAmount = findNearest(
        amount,
        commonAmounts,
        (candidate) => candidate,
        (candidate) =>
          candidate <= maxAmount && countPrivacyPoolsDepositsOf(depositIndex.recent, candidate) > 0
      )
      if (commonAmount === undefined) return []

      return [setAmountAction(commonAmount, COMMON_AMOUNT_LABEL)]
    }
  }
]
