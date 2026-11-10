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
    title: 'This amount points straight to your deposit',
    text: 'You are sending all of your deposit, and nobody else has ever deposited this exact amount. Anyone who compares amounts can see this transfer came from your deposit, and from the address you deposited with. Sending a common amount mixes you in with other people.',
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
    title: 'You are sending back to the address that deposited',
    text: 'Everyone can see that this address made the deposit. Sending to it shows the deposit is still yours. Anyone can then connect the rest of this deposit, and any earlier transfers from it, to you. Send to an address that has never been linked to you instead.',
    applies: isRevealingSendToDepositor
  },
  {
    id: 'empties-partly-sent-deposit',
    type: 'warning',
    title: 'This uses up the rest of a deposit',
    text: 'You already sent part of this deposit, and this transfer sends what is left. Someone who adds up your transfers can see they match your deposit exactly, and guess they all came from you. Waiting until more people send from the pool makes this much harder.',
    applies: ({ spends }) =>
      spends.some(({ note, amount }) => note.withdrawCount > 0 && amount === note.amount)
  },
  {
    id: 'several-deposits',
    type: 'warning',
    title: 'This transfer uses more than one deposit',
    text: 'None of your deposits can pay this amount alone, so this transfer takes money from several of them. This shows they all belong to the same person. If one of them is ever linked to you, the others will be too. Sending an amount that one deposit can pay avoids this.',
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
    title: 'This account in your wallet was already used',
    text: 'This account in your wallet was already used on this network. If it was ever used together with the account you deposited from, anyone can follow that link back to you. Send to a new account that was never used instead.',
    applies: (facts) => isOwnAccountSend(facts) && facts.isRecipientUsed === true
  },
  {
    id: 'recipient-has-no-eth',
    type: 'warning',
    title: 'The recipient has no ETH to pay fees',
    text: 'Moving these tokens later costs a small fee paid in ETH, and the recipient has none. If you send ETH there from an address you already use, anyone can see it and connect these tokens to you. Send the ETH from Privacy Pools too, so nothing links the two.',
    applies: ({ recipientHasEth }) => recipientHasEth === false
  },
  {
    id: 'fresh-deposit',
    type: 'warning',
    title: 'You deposited this money recently',
    text: 'Few people have deposited since you did. If you send this money soon after you deposit it, anyone who compares the times can guess that this transfer is yours. Wait at least a day to make this harder.',
    applies: ({ spends, depositIndex }) =>
      spends.some(({ note }) => note.blockNumber > depositIndex.freshAfterBlock)
  },
  // Excludes the `own-account-used` leak, which is the same send to an account that was already used
  {
    id: 'own-account',
    type: 'info',
    title: 'You are sending to another account in this wallet',
    text: 'This account is in your wallet. We found no sign that it was used on this network, but we cannot be 100% sure it was never linked to your other accounts. Please make sure it was never used together with the account you deposited from. Also avoid using them together later, or anyone can link this transfer to you.',
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
    text: 'Your deposit will be the only one of this exact amount. This is fine if you later send different amounts, for example several smaller transfers. Only sending this exact amount out in one transfer would point back to you.',
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
