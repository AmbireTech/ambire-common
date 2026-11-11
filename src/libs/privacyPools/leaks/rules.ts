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

/** Sending back to the depositor already says more than sending to an account of the wallet. */
const isOwnAccountSend = (facts: WithdrawalFacts) =>
  facts.isOwnAccount && !isRevealingSendToDepositor(facts)

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
    // All deposits, as one of someone else's older than the recent ones still hides it
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
  {
    id: 'empties-partly-sent-deposit',
    type: 'warning',
    title: 'Consider sending the rest later',
    text: 'Your transfers from this deposit add up to it, which makes them easier to connect. More activity in the pool makes this harder.',
    applies: ({ spends }) =>
      spends.some(({ note, amount }) => note.withdrawCount > 0 && amount === note.amount)
  },
  {
    id: 'several-deposits',
    type: 'warning',
    title: 'This transfer uses several deposits',
    text: 'This shows they all belong to the same person. If one of them is ever linked to you, all of them will be.',
    applies: ({ spends }) => spends.length > 1,
    getActions: ({ spends }) => [
      // The SDK spends the largest note first, so this amount spends it alone
      setAmountAction(spends[0]!.note.amount, 'Send from one deposit')
    ]
  },
  // Excludes the `own-account` leak, which is the same send to an account that was not used
  {
    id: 'own-account-used',
    type: 'warning',
    title: 'This account was already used',
    text: 'If it was ever used together with the account you deposited from, this transfer will be linked to you. Consider a new account.',
    applies: (facts) => isOwnAccountSend(facts) && facts.isRecipientUsed === true
  },
  {
    id: 'recipient-has-no-eth',
    type: 'warning',
    title: 'The recipient will need ETH for fees',
    text: 'If you send it ETH from an address you already use, these tokens will be linked to you. Send the ETH from Privacy Pools too.',
    applies: ({ recipientHasEth }) => recipientHasEth === false
  },
  {
    id: 'fresh-deposit',
    type: 'warning',
    title: 'Consider waiting a day',
    text: 'Few people have deposited since you did, so sending now makes the timing easier to match.',
    applies: ({ spends, depositIndex }) =>
      spends.some(({ note }) => note.blockNumber > depositIndex.freshAfterBlock)
  },
  // Excludes the `own-account-used` leak, which is the same send to an account that was already used
  {
    id: 'own-account',
    type: 'info',
    title: 'Keep these accounts apart',
    text: 'This account is in your wallet. If it is ever used together with the account you deposited from, this transfer will be linked to you.',
    applies: (facts) => isOwnAccountSend(facts) && facts.isRecipientUsed !== true
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
