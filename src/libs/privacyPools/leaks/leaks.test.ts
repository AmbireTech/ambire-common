import { Hex } from '../../../interfaces/hex'
import { PrivacyPoolsNote } from '../../../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../../../services/socket/constants'
import { getPrivacyPoolsNotesToSpend } from './helpers'
import { getPrivacyPoolsDepositPrivacy, getPrivacyPoolsWithdrawalPrivacy } from './leaks'
import { buildPrivacyPoolsDepositIndex } from '../poolStats'

const DEPOSITOR: Hex = '0x00000000000000000000000000000000000000d1'
const STRANGER = '0x00000000000000000000000000000000000000a1'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const COMMON_AMOUNTS = [10n, 50n, 100n]

/**
 * The pool: three of 10, two of 50 and of 100, one each of 37 and 500, oldest first, at blocks 10
 * to 90. All are recent, and none is fresh.
 */
const DEPOSIT_INDEX = buildPrivacyPoolsDepositIndex(
  [10n, 10n, 10n, 37n, 50n, 50n, 100n, 100n, 500n].map((value, i) => ({
    value,
    blockNumber: BigInt(i + 1) * 10n
  })),
  0n,
  90n
)

let nextLabel = 1n

/** An approved ETH note from `DEPOSITOR`, never sent from, of its whole 100 deposit at block 70. */
const note = (overrides: Partial<PrivacyPoolsNote> = {}): PrivacyPoolsNote => {
  const label = nextLabel++

  return {
    label,
    tokenAddress: ZERO_ADDRESS,
    amount: 100n,
    approval: 'approved',
    depositorAddr: DEPOSITOR,
    depositIndex: Number(label),
    depositValue: 100n,
    withdrawCount: 0,
    blockNumber: 70n,
    ...overrides
  }
}

const getWithdrawalPrivacy = ({
  amount,
  notes,
  recipient = STRANGER,
  isOwnAccount = false,
  isRecipientUsed = null,
  recipientHasEth = null
}: {
  amount: bigint
  notes: PrivacyPoolsNote[]
  recipient?: string | null
  isOwnAccount?: boolean
  isRecipientUsed?: boolean | null
  recipientHasEth?: boolean | null
}) => {
  const privacy = getPrivacyPoolsWithdrawalPrivacy({
    amount,
    notes,
    tokenAddress: ZERO_ADDRESS,
    recipient,
    isOwnAccount,
    isRecipientUsed,
    recipientHasEth,
    depositIndex: DEPOSIT_INDEX,
    commonAmounts: COMMON_AMOUNTS
  })
  if (!privacy) throw new Error(`The notes cannot pay ${amount}`)

  return privacy
}

/** Each leak's id with its actions' amounts, so a failure shows what was found. */
const summarizeLeaks = (privacy: ReturnType<typeof getWithdrawalPrivacy>) =>
  privacy.leaks.map(({ id, actions }) => ({ id, amounts: actions.map(({ meta }) => meta.amount) }))

describe('getPrivacyPoolsNotesToSpend', () => {
  test('spends approved notes of the token largest first, ties in the order listed', () => {
    const small = note({ amount: 30n })
    const firstTied = note({ amount: 60n })
    const secondTied = note({ amount: 60n })
    const notes = [
      small,
      note({ amount: 500n, approval: 'pending' }),
      note({ amount: 500n, tokenAddress: USDC }),
      note({ amount: 0n }),
      firstTied,
      secondTied
    ]

    expect(getPrivacyPoolsNotesToSpend(notes, ZERO_ADDRESS, 130n)).toEqual([
      { note: firstTied, amount: 60n },
      { note: secondTied, amount: 60n },
      { note: small, amount: 10n }
    ])
  })

  test('spends nothing when the notes cannot pay, or for no amount', () => {
    const notes = [note({ amount: 30n }), note({ amount: 500n, approval: 'pending' })]

    expect(getPrivacyPoolsNotesToSpend(notes, ZERO_ADDRESS, 31n)).toBeNull()
    expect(getPrivacyPoolsNotesToSpend(notes, ZERO_ADDRESS, 0n)).toBeNull()
  })
})

describe('getPrivacyPoolsWithdrawalPrivacy', () => {
  test('rates a send with no leak standard and counts the deposits that hide it', () => {
    const privacy = getWithdrawalPrivacy({ amount: 60n, notes: [note()] })

    expect(privacy.rating).toBe('standard')
    expect(privacy.leaks).toEqual([])
    // At least 60: the two 100s and the 500, less the user's own 100. Of exactly 60: none
    expect(privacy.cover).toEqual({ bigEnough: 2, sameAmount: 0 })
    expect(privacy.notesCount).toBe(1)
  })

  test('rates a send unchecked before the pool is read, and still has none the notes cannot pay', () => {
    const getPrivacy = (amount: bigint) =>
      getPrivacyPoolsWithdrawalPrivacy({
        amount,
        notes: [note({ amount: 37n, depositValue: 37n })],
        tokenAddress: ZERO_ADDRESS,
        recipient: DEPOSITOR,
        isOwnAccount: false,
        isRecipientUsed: null,
        recipientHasEth: null,
        depositIndex: null,
        commonAmounts: COMMON_AMOUNTS
      })

    // Back to the depositor, which would be traceable, but nothing can be checked
    expect(getPrivacy(10n)).toEqual({
      rating: 'unchecked',
      leaks: [],
      cover: { bigEnough: 0, sameAmount: 0 },
      notesCount: 1
    })
    expect(getPrivacy(38n)).toBeNull()
  })

  describe('unique amount', () => {
    const uniqueNote = note({ amount: 37n, depositValue: 37n, blockNumber: 40n })

    test('is traceable when a whole deposit no other has the amount of is spent', () => {
      const privacy = getWithdrawalPrivacy({ amount: 37n, notes: [uniqueNote] })

      expect(privacy.rating).toBe('traceable')
      // 10 is the nearest amount other deposits have that the note pays
      expect(summarizeLeaks(privacy)).toEqual([{ id: 'unique-amount', amounts: [10n] }])
    })

    test('is not a leak when part of the deposit is spent', () => {
      expect(getWithdrawalPrivacy({ amount: 36n, notes: [uniqueNote] }).leaks).toEqual([])
    })

    test('is not a leak when another deposit has the same amount', () => {
      expect(getWithdrawalPrivacy({ amount: 100n, notes: [note()] }).leaks).toEqual([])
    })

    test('is traceable when it is one of several notes spent', () => {
      const privacy = getWithdrawalPrivacy({ amount: 137n, notes: [note(), uniqueNote] })

      expect(privacy.rating).toBe('traceable')
      // The only 37 is the user's own
      expect(privacy.cover.sameAmount).toBe(0)
      expect(privacy.leaks.map(({ id }) => id)).toEqual(['unique-amount', 'several-deposits'])
    })

    test('counts an old deposit of the user, so one recent deposit of the amount still hides it', () => {
      // The user's 37 at block 40 is older than the recent ones, the other 37 at block 90 is not
      const depositIndex = buildPrivacyPoolsDepositIndex(
        [
          { value: 37n, blockNumber: 40n },
          { value: 37n, blockNumber: 90n },
          { value: 100n, blockNumber: 30n }
        ],
        50n,
        90n
      )
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: 37n,
        notes: [uniqueNote],
        tokenAddress: ZERO_ADDRESS,
        recipient: STRANGER,
        isOwnAccount: false,
        isRecipientUsed: null,
        recipientHasEth: null,
        depositIndex,
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy?.leaks).toEqual([])
      // The old 100 and the user's own 37 are not shown as hiding the send
      expect(privacy?.cover).toEqual({ bigEnough: 1, sameAmount: 1 })
    })

    test("is traceable when the other deposits of the amount are the user's own", () => {
      // Two deposits of 37, both made by the user from the same address
      const depositIndex = buildPrivacyPoolsDepositIndex(
        [
          { value: 37n, blockNumber: 40n },
          { value: 37n, blockNumber: 50n },
          { value: 100n, blockNumber: 30n }
        ],
        0n,
        90n
      )
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: 37n,
        notes: [uniqueNote, note({ amount: 37n, depositValue: 37n, blockNumber: 50n })],
        tokenAddress: ZERO_ADDRESS,
        recipient: STRANGER,
        isOwnAccount: false,
        isRecipientUsed: null,
        recipientHasEth: null,
        depositIndex,
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy?.rating).toBe('traceable')
      expect(privacy?.leaks.map(({ id }) => id)).toEqual(['unique-amount'])
      // The 100 hides it, the user's own 37s do not
      expect(privacy?.cover).toEqual({ bigEnough: 1, sameAmount: 0 })
    })

    test("counts another account's deposit of the amount, but not a pending note of the user", () => {
      const depositIndex = buildPrivacyPoolsDepositIndex(
        [
          { value: 37n, blockNumber: 40n },
          { value: 37n, blockNumber: 50n }
        ],
        0n,
        90n
      )
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: 37n,
        // Not verified yet, so it is not among the pool's counted deposits either
        notes: [uniqueNote, note({ amount: 37n, depositValue: 37n, approval: 'pending' })],
        tokenAddress: ZERO_ADDRESS,
        recipient: STRANGER,
        isOwnAccount: false,
        isRecipientUsed: null,
        recipientHasEth: null,
        depositIndex,
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy?.leaks).toEqual([])
      expect(privacy?.cover.sameAmount).toBe(1)
    })
  })

  describe('fresh deposit', () => {
    test('is weak when the spent deposit was made after the fresh block', () => {
      const privacy = getWithdrawalPrivacy({ amount: 100n, notes: [note({ blockNumber: 91n })] })

      expect(privacy.rating).toBe('weak')
      expect(summarizeLeaks(privacy)).toEqual([{ id: 'fresh-deposit', amounts: [] }])
    })

    test('is not a leak for a deposit of the fresh block itself', () => {
      expect(
        getWithdrawalPrivacy({ amount: 100n, notes: [note({ blockNumber: 90n })] }).leaks
      ).toEqual([])
    })

    test('is weak when only one of several spent deposits is fresh', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 150n,
        notes: [note(), note({ amount: 50n, depositValue: 50n, blockNumber: 95n })]
      })

      expect(privacy.leaks.map(({ id }) => id)).toEqual(['several-deposits', 'fresh-deposit'])
    })

    test('lists errors first, then warnings, then notes', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 37n,
        notes: [note({ amount: 37n, depositValue: 37n, blockNumber: 91n })],
        isOwnAccount: true,
        isRecipientUsed: false
      })

      expect(privacy.leaks.map(({ id, type }) => `${type} ${id}`)).toEqual([
        'error unique-amount',
        'warning fresh-deposit',
        'info own-account'
      ])
    })
  })

  describe('back to the depositor', () => {
    test('is a leak to send part of an unsent deposit back', () => {
      const privacy = getWithdrawalPrivacy({ amount: 40n, notes: [note()], recipient: DEPOSITOR })

      expect(privacy.rating).toBe('traceable')
      expect(summarizeLeaks(privacy)).toEqual([{ id: 'send-to-depositor', amounts: [] }])
    })

    test('checks only the amount before a recipient is entered', () => {
      const privacy = getWithdrawalPrivacy({ amount: 40n, notes: [note()], recipient: null })

      expect(privacy.rating).toBe('standard')
      expect(summarizeLeaks(privacy)).toEqual([])
    })

    test('is a leak to send part of a partly sent deposit back, in any address case', () => {
      const partlySentNote = note({ amount: 60n, withdrawCount: 1 })
      const privacy = getWithdrawalPrivacy({
        amount: 20n,
        notes: [partlySentNote],
        recipient: DEPOSITOR.toUpperCase().replace('0X', '0x')
      })

      expect(summarizeLeaks(privacy)).toEqual([{ id: 'send-to-depositor', amounts: [] }])
    })

    test('is a leak to send all of a partly sent deposit back', () => {
      const partlySentNote = note({ amount: 60n, withdrawCount: 1 })
      const privacy = getWithdrawalPrivacy({
        amount: 60n,
        notes: [partlySentNote],
        recipient: DEPOSITOR
      })

      expect(summarizeLeaks(privacy)).toEqual([
        { id: 'send-to-depositor', amounts: [] },
        { id: 'empties-partly-sent-deposit', amounts: [] }
      ])
    })

    test('is not a leak to send all of an unsent deposit back', () => {
      const privacy = getWithdrawalPrivacy({ amount: 100n, notes: [note()], recipient: DEPOSITOR })

      expect(privacy.leaks).toEqual([])
    })

    test('is told instead of the own account leak', () => {
      const partial = getWithdrawalPrivacy({
        amount: 40n,
        notes: [note()],
        recipient: DEPOSITOR,
        isOwnAccount: true
      })
      const whole = getWithdrawalPrivacy({
        amount: 100n,
        notes: [note()],
        recipient: DEPOSITOR,
        isOwnAccount: true
      })

      expect(partial.leaks.map(({ id }) => id)).toEqual(['send-to-depositor'])
      expect(whole.leaks.map(({ id }) => id)).toEqual(['own-account'])

      const usedWhole = getWithdrawalPrivacy({
        amount: 100n,
        notes: [note()],
        recipient: DEPOSITOR,
        isOwnAccount: true,
        isRecipientUsed: true
      })
      expect(usedWhole.leaks.map(({ id }) => id)).toEqual(['own-account-used'])
      const usedPartial = getWithdrawalPrivacy({
        amount: 40n,
        notes: [note()],
        recipient: DEPOSITOR,
        isOwnAccount: true,
        isRecipientUsed: true
      })
      expect(usedPartial.leaks.map(({ id }) => id)).toEqual(['send-to-depositor'])
    })
  })

  test('weakens privacy to use up a deposit earlier sends took part of, not to send part of it', () => {
    const partlySentNote = note({ amount: 60n, withdrawCount: 1 })

    const emptying = getWithdrawalPrivacy({ amount: 60n, notes: [partlySentNote] })
    expect(emptying.rating).toBe('weak')
    expect(summarizeLeaks(emptying)).toEqual([{ id: 'empties-partly-sent-deposit', amounts: [] }])

    expect(getWithdrawalPrivacy({ amount: 30n, notes: [partlySentNote] }).leaks).toEqual([])
  })

  test('suggests the largest note alone when several are spent', () => {
    const notes = [note({ amount: 30n, depositValue: 50n }), note()]

    const privacy = getWithdrawalPrivacy({ amount: 120n, notes })
    expect(privacy.rating).toBe('weak')
    expect(privacy.notesCount).toBe(2)
    expect(summarizeLeaks(privacy)).toEqual([{ id: 'several-deposits', amounts: [100n] }])

    expect(getWithdrawalPrivacy({ amount: 100n, notes }).leaks).toEqual([])
  })

  describe('to another account in the wallet', () => {
    test('only notes an account that was never used, and keeps the rating', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 40n,
        notes: [note()],
        isOwnAccount: true,
        isRecipientUsed: false
      })

      expect(summarizeLeaks(privacy)).toEqual([{ id: 'own-account', amounts: [] }])
      expect(privacy.leaks[0]?.type).toBe('info')
      expect(privacy.rating).toBe('standard')
    })

    test('weakens privacy when the account was used', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 40n,
        notes: [note()],
        isOwnAccount: true,
        isRecipientUsed: true
      })

      expect(summarizeLeaks(privacy)).toEqual([{ id: 'own-account-used', amounts: [] }])
      expect(privacy.rating).toBe('weak')
    })

    test('only notes it when it was not checked, as the controller treats a failed read as used', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 40n,
        notes: [note()],
        isOwnAccount: true,
        isRecipientUsed: null
      })

      expect(privacy.leaks.map(({ id }) => id)).toEqual(['own-account'])
    })

    test('has neither leak when the recipient is not in the wallet', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 40n,
        notes: [note()],
        isOwnAccount: false,
        isRecipientUsed: true
      })

      expect(privacy.leaks).toEqual([])
    })

    test('keeps a warning rating when an info leak comes with a warning', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 40n,
        notes: [note()],
        isOwnAccount: true,
        isRecipientUsed: false,
        recipientHasEth: false
      })

      expect(privacy.leaks.map(({ id }) => id)).toEqual(['recipient-has-no-eth', 'own-account'])
      expect(privacy.rating).toBe('weak')
    })
  })

  describe('with no amount yet', () => {
    test('checks the recipient, with no cover', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 0n,
        notes: [note()],
        isOwnAccount: true,
        isRecipientUsed: true,
        recipientHasEth: false
      })

      expect(summarizeLeaks(privacy)).toEqual([
        { id: 'own-account-used', amounts: [] },
        { id: 'recipient-has-no-eth', amounts: [] }
      ])
      expect(privacy.rating).toBe('weak')
      expect(privacy.cover).toEqual({ bigEnough: 0, sameAmount: 0 })
      expect(privacy.notesCount).toBe(0)
    })

    test('finds no leak of the amount or the deposits, which none is spent from yet', () => {
      // A fresh deposit and a partly sent one, to their depositor, would each leak with an amount
      const notes = [note({ blockNumber: 91n }), note({ amount: 60n, withdrawCount: 1 })]

      const privacy = getWithdrawalPrivacy({ amount: 0n, notes, recipient: DEPOSITOR })
      expect(privacy.leaks).toEqual([])
      expect(privacy.rating).toBe('standard')
    })

    test('is null for a negative amount', () => {
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: -1n,
        notes: [note()],
        tokenAddress: ZERO_ADDRESS,
        recipient: STRANGER,
        isOwnAccount: false,
        isRecipientUsed: null,
        recipientHasEth: null,
        depositIndex: DEPOSIT_INDEX,
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy).toBeNull()
    })
  })

  test('weakens privacy to send tokens to a recipient with no ETH, only when checked', () => {
    const noEth = getWithdrawalPrivacy({ amount: 40n, notes: [note()], recipientHasEth: false })
    expect(noEth.rating).toBe('weak')
    expect(summarizeLeaks(noEth)).toEqual([{ id: 'recipient-has-no-eth', amounts: [] }])

    expect(
      getWithdrawalPrivacy({ amount: 40n, notes: [note()], recipientHasEth: true }).leaks
    ).toEqual([])
    expect(
      getWithdrawalPrivacy({ amount: 40n, notes: [note()], recipientHasEth: null }).leaks
    ).toEqual([])
  })

  test('has no privacy for an amount the notes cannot pay', () => {
    expect(
      getPrivacyPoolsWithdrawalPrivacy({
        amount: 101n,
        notes: [note()],
        tokenAddress: ZERO_ADDRESS,
        recipient: STRANGER,
        isOwnAccount: false,
        isRecipientUsed: null,
        recipientHasEth: null,
        depositIndex: DEPOSIT_INDEX,
        commonAmounts: COMMON_AMOUNTS
      })
    ).toBeNull()
  })
})

describe('getPrivacyPoolsDepositPrivacy', () => {
  const getDepositPrivacy = (amount: bigint, maxAmount = 1_000n, commonAmounts = COMMON_AMOUNTS) =>
    getPrivacyPoolsDepositPrivacy({
      amount,
      maxAmount,
      depositIndex: DEPOSIT_INDEX,
      commonAmounts
    })

  test('rates a common amount standard', () => {
    const privacy = getDepositPrivacy(50n)

    expect(privacy.rating).toBe('standard')
    expect(privacy.leaks).toEqual([])
    expect(privacy.sameAmount).toBe(2)
  })

  test('only notes an unusual amount, and suggests the nearest lower common one others deposited', () => {
    // 20 is lower and nearer, but nobody deposited it
    const privacy = getDepositPrivacy(42n, 1_000n, [10n, 20n, 50n])

    expect(privacy.rating).toBe('standard')
    expect(privacy.leaks[0]?.type).toBe('info')
    expect(privacy.leaks.map(({ id, actions }) => ({ id, actions }))).toEqual([
      {
        id: 'unusual-deposit-amount',
        actions: [{ actionName: 'set-amount', meta: { amount: 10n }, label: 'Use a common amount' }]
      }
    ])
  })

  test('suggests a higher common amount only when the balance pays it', () => {
    expect(getDepositPrivacy(5n).leaks[0]?.actions.map(({ meta }) => meta.amount)).toEqual([10n])
    expect(getDepositPrivacy(5n, 9n).leaks[0]?.actions).toEqual([])
  })

  test('rates a deposit unchecked before the pool is read', () => {
    expect(
      getPrivacyPoolsDepositPrivacy({
        amount: 42n,
        maxAmount: 1_000n,
        depositIndex: null,
        commonAmounts: COMMON_AMOUNTS
      })
    ).toEqual({ rating: 'unchecked', leaks: [], sameAmount: 0 })
  })

  test('has no leak before an amount is typed', () => {
    const privacy = getDepositPrivacy(0n, 60n)

    expect(privacy.leaks).toEqual([])
    expect(privacy.rating).toBe('standard')
  })
})
