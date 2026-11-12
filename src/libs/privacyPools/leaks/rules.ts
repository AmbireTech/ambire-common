import { countPrivacyPoolsDepositsOf } from '../poolStats'
import { countOthers, findNearest, getPrivacyPoolsNotesToSpend, setAmountAction } from './helpers'
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

type DepositorSendFacts = Pick<WithdrawalFacts, 'spends' | 'recipient'>

const isToDepositor = ({ note }: PrivacyPoolsNoteSpend, recipient: string | null) =>
  !!recipient && note.depositorAddr.toLowerCase() === recipient.toLowerCase()

/** Part of a deposit no send has touched goes back, so its rest can be matched to later sends. */
const isPartOfUnsentDepositToDepositor = ({ spends, recipient }: DepositorSendFacts) =>
  spends.some(
    (spend) =>
      isToDepositor(spend, recipient) &&
      spend.note.withdrawCount === 0 &&
      spend.amount < spend.note.amount
  )

/** Any of a deposit that earlier sends took part of goes back, which links those sends to it. */
const isPartlySentDepositToDepositor = ({ spends, recipient }: DepositorSendFacts) =>
  spends.some((spend) => isToDepositor(spend, recipient) && spend.note.withdrawCount > 0)

/**
 * Sending a whole deposit back that no send has touched is fine, as it leaves nothing to link
 * later. Anything else lets the rest of the deposit be matched to the depositor's other sends.
 */
const isRevealingSendToDepositor = (facts: DepositorSendFacts) =>
  isPartOfUnsentDepositToDepositor(facts) || isPartlySentDepositToDepositor(facts)

/**
 * The amount that sends all of the deposit this send takes only part of. Undefined when that
 * still reveals the depositor, as for a deposit that earlier sends already took part of.
 */
const findWholeDepositAmount = ({
  amount,
  notes,
  tokenAddress,
  spends,
  recipient
}: WithdrawalFacts) => {
  // Every spend but the last takes its whole deposit, as the SDK spends them in that order
  const lastSpend = spends[spends.length - 1]
  if (!lastSpend || lastSpend.amount === lastSpend.note.amount) return undefined

  const wholeDepositAmount = amount + lastSpend.note.amount - lastSpend.amount
  const wholeDepositSpends = getPrivacyPoolsNotesToSpend(notes, tokenAddress, wholeDepositAmount)
  if (!wholeDepositSpends || isRevealingSendToDepositor({ spends: wholeDepositSpends, recipient }))
    return undefined

  return wholeDepositAmount
}

/**
 * The leaks a send can have. Written worst first (error, warning, info), which is the order the
 * user sees them in.
 */
export const WITHDRAWAL_LEAKS: LeakRule<WithdrawalFacts>[] = [
  {
    id: 'unique-amount',
    type: 'error',
    title: 'Only you deposited this amount, making this send traceable',
    text: 'Anyone can match a send to a deposit of the same unique amount, which links the recipient to the address you deposited from. Send a common amount so it blends in.',
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
  // Warnings, as the rest of the deposit and the other sends can still hide behind common amounts
  {
    id: 'send-to-depositor',
    type: 'warning',
    title: 'Sending part of your deposit back here can make the rest easier to trace',
    text: 'Anyone can see this address made the deposit, so the rest of it may be matched to your other sends, mostly when their amounts are unusual. Send the whole deposit, or change the recipient.',
    applies: isPartOfUnsentDepositToDepositor,
    getActions: (facts) => {
      const wholeDepositAmount = findWholeDepositAmount(facts)
      if (wholeDepositAmount === undefined) return []

      return [setAmountAction(wholeDepositAmount, WHOLE_DEPOSIT_LABEL)]
    }
  },
  // No amount fixes it, as the part sent earlier can't be sent back whole
  {
    id: 'send-rest-to-depositor',
    type: 'warning',
    title: 'This address made the deposit, so sending here may link your earlier sends to you',
    text: 'Anyone can see this address made the deposit. Part of it was already sent elsewhere, so sending more of it here can help match those sends to you, mostly when their amounts are unusual. Send to a different address.',
    applies: isPartlySentDepositToDepositor
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
    title: 'This deposit is less than a day old, making it easier to link to you',
    text: 'Anyone can see when you deposited and when you send, and a send soon after a deposit is an easy match. Wait a day or more, so more people deposit in between.',
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
    title: 'No one else has deposited this amount, so it stands out',
    text: 'You can still send it privately, just never all of it in one send, as that points straight back to this deposit. A common amount makes it harder to make mistakes later.',
    // Counts all deposits, not only recent ones, the same as `unique-amount` does for the send
    applies: ({ amount, depositIndex }) => countPrivacyPoolsDepositsOf(depositIndex, amount) === 0,
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
