import { Hex } from '../../../interfaces/hex'
import { PrivacyPoolsNote } from '../../../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../../../services/socket/constants'
import { PrivacyPoolsCoverDeposit, PrivacyPoolsPoolCover } from '../poolStats'
import { getPrivacyPoolsNoteSpend } from './helpers'
import { getPrivacyPoolsDepositPrivacy, getPrivacyPoolsWithdrawalPrivacy } from './leaks'

const DEPOSITOR: Hex = '0x00000000000000000000000000000000000000d1'
const STRANGER = '0x00000000000000000000000000000000000000a1'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const COMMON_AMOUNTS = [10n, 50n, 100n]

let nextLabel = 1n

/** A stranger's deposit, with a label of its own unless one is given. */
const poolDeposit = (
  value: bigint,
  blockNumber: bigint,
  overrides: Partial<PrivacyPoolsCoverDeposit> = {}
): PrivacyPoolsCoverDeposit => ({
  value,
  blockNumber,
  depositor: STRANGER,
  label: nextLabel++,
  ...overrides
})

/** A pool of `deposits`, all in the cover window, of which those after block 90 are fresh. */
const poolCoverOf = (
  deposits: PrivacyPoolsCoverDeposit[],
  coverWindowStartBlock = 0n
): PrivacyPoolsPoolCover => ({ deposits, coverWindowStartBlock, dayAgoBlock: 90n })

/**
 * The pool: three of 10, two of 50 and of 100, one each of 37 and 500, oldest first, at blocks 10
 * to 90. All are in the cover window, and none is fresh.
 */
const POOL_DEPOSITS = [10n, 10n, 10n, 37n, 50n, 50n, 100n, 100n, 500n].map((value, i) =>
  poolDeposit(value, BigInt(i + 1) * 10n)
)
const POOL_COVER = poolCoverOf(POOL_DEPOSITS)
/** Of the pool's deposits, the 37 and the first 100 are the user's, as `note` makes them. */
const OWN_37_LABEL = POOL_DEPOSITS[3]!.label
const OWN_100_LABEL = POOL_DEPOSITS[6]!.label

/** No depositor is an Ambire account, so every send hides among all deposits. */
const countingAllDeposits = (poolCover: PrivacyPoolsPoolCover | null) => ({
  poolCover,
  fingerprints: new Map([
    [DEPOSITOR, false],
    [STRANGER, false]
  ])
})

/**
 * An approved ETH note from `DEPOSITOR`, never sent from, of its whole 100 deposit at block 70,
 * which is not one of the pool's deposits unless its label is.
 */
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

/** A send from `spentNote`, by default the first of `notes`. */
const getWithdrawalPrivacy = ({
  amount,
  notes,
  spentNote = notes[0]!,
  recipient = STRANGER,
  poolCover = POOL_COVER
}: {
  amount: bigint
  notes: PrivacyPoolsNote[]
  spentNote?: PrivacyPoolsNote
  recipient?: string | null
  poolCover?: PrivacyPoolsPoolCover
}) => {
  const privacy = getPrivacyPoolsWithdrawalPrivacy({
    amount,
    notes,
    tokenAddress: ZERO_ADDRESS,
    noteLabel: spentNote.label,
    recipient,
    ...countingAllDeposits(poolCover),
    commonAmounts: COMMON_AMOUNTS
  })
  if (!privacy) throw new Error(`The notes cannot pay ${amount}`)

  return privacy
}

/** Each leak's id with its actions' amounts, so a failure shows what was found. */
const summarizeLeaks = (privacy: ReturnType<typeof getWithdrawalPrivacy>) =>
  privacy.leaks.map(({ id, actions }) => ({ id, amounts: actions.map(({ meta }) => meta.amount) }))

describe('getPrivacyPoolsNoteSpend', () => {
  test('spends the amount from the chosen deposit only', () => {
    const chosen = note({ amount: 60n })
    const notes = [note({ amount: 500n }), chosen, note({ amount: 30n })]

    expect(getPrivacyPoolsNoteSpend(notes, ZERO_ADDRESS, chosen.label, 40n)).toEqual({
      note: chosen,
      amount: 40n
    })
    expect(getPrivacyPoolsNoteSpend(notes, ZERO_ADDRESS, chosen.label, 60n)).toEqual({
      note: chosen,
      amount: 60n
    })
  })

  test('spends nothing when the chosen deposit cannot pay, even if others could together', () => {
    const chosen = note({ amount: 30n })
    const notes = [chosen, note({ amount: 30n })]

    expect(getPrivacyPoolsNoteSpend(notes, ZERO_ADDRESS, chosen.label, 31n)).toBeNull()
  })

  test('spends nothing from a pending deposit, one of another token, or an unknown one', () => {
    const pending = note({ amount: 500n, approval: 'pending' })
    const usdc = note({ amount: 500n, tokenAddress: USDC })
    const notes = [pending, usdc, note()]

    expect(getPrivacyPoolsNoteSpend(notes, ZERO_ADDRESS, pending.label, 10n)).toBeNull()
    expect(getPrivacyPoolsNoteSpend(notes, ZERO_ADDRESS, usdc.label, 10n)).toBeNull()
    expect(getPrivacyPoolsNoteSpend(notes, ZERO_ADDRESS, 9_999n, 10n)).toBeNull()
  })

  test('spends nothing for no amount or a negative one', () => {
    const chosen = note()

    expect(getPrivacyPoolsNoteSpend([chosen], ZERO_ADDRESS, chosen.label, 0n)).toBeNull()
    expect(getPrivacyPoolsNoteSpend([chosen], ZERO_ADDRESS, chosen.label, -1n)).toBeNull()
  })
})

describe('getPrivacyPoolsWithdrawalPrivacy', () => {
  test('rates a send with no leak standard and counts the deposits that hide it', () => {
    const privacy = getWithdrawalPrivacy({ amount: 60n, notes: [note({ label: OWN_100_LABEL })] })

    expect(privacy.rating).toBe('standard')
    expect(privacy.leaks).toEqual([])
    // At least 60: the two 100s and the 500, less the user's own 100. Of exactly 60: none
    expect(privacy.cover).toEqual({ bigEnough: 2, sameAmount: 0 })
  })

  test('rates a send unchecked before the pool is read, and still has none the notes cannot pay', () => {
    const spentNote = note({ amount: 37n, depositValue: 37n })
    const getPrivacy = (amount: bigint) =>
      getPrivacyPoolsWithdrawalPrivacy({
        amount,
        notes: [spentNote],
        tokenAddress: ZERO_ADDRESS,
        noteLabel: spentNote.label,
        recipient: DEPOSITOR,
        ...countingAllDeposits(null),
        commonAmounts: COMMON_AMOUNTS
      })

    // Back to the depositor, which would be traceable, but nothing can be checked
    expect(getPrivacy(10n)).toEqual({
      rating: 'unchecked',
      leaks: [],
      cover: { bigEnough: 0, sameAmount: 0 }
    })
    expect(getPrivacy(38n)).toBeNull()
  })

  describe('unique amount', () => {
    const uniqueNote = note({
      amount: 37n,
      depositValue: 37n,
      blockNumber: 40n,
      label: OWN_37_LABEL
    })

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

    test('checks only the deposit spent, not the others of the account', () => {
      const notes = [note(), uniqueNote]
      const uniqueSend = getWithdrawalPrivacy({ amount: 37n, notes, spentNote: uniqueNote })

      expect(uniqueSend.rating).toBe('traceable')
      // The only 37 is the user's own
      expect(uniqueSend.cover.sameAmount).toBe(0)
      expect(getWithdrawalPrivacy({ amount: 100n, notes }).leaks).toEqual([])
    })

    test('counts an old deposit of the user, so one deposit of the amount in the cover window still hides it', () => {
      // The user's 37 at block 40 is before the cover window, the other 37 at block 90 is not
      const poolCover = poolCoverOf(
        [
          poolDeposit(37n, 40n, { label: uniqueNote.label }),
          poolDeposit(37n, 90n),
          poolDeposit(100n, 30n)
        ],
        50n
      )
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: 37n,
        notes: [uniqueNote],
        tokenAddress: ZERO_ADDRESS,
        noteLabel: uniqueNote.label,
        recipient: STRANGER,
        ...countingAllDeposits(poolCover),
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy?.leaks).toEqual([])
      // The old 100 and the user's own 37 are not shown as hiding the send
      expect(privacy?.cover).toEqual({ bigEnough: 1, sameAmount: 1 })
    })

    test("is traceable when the other deposits of the amount are the user's own", () => {
      // Two deposits of 37, both made by the user from the same address
      const otherOwnNote = note({ amount: 37n, depositValue: 37n, blockNumber: 50n })
      const poolCover = poolCoverOf([
        poolDeposit(37n, 40n, { label: uniqueNote.label }),
        poolDeposit(37n, 50n, { label: otherOwnNote.label }),
        poolDeposit(100n, 30n)
      ])
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: 37n,
        notes: [uniqueNote, otherOwnNote],
        tokenAddress: ZERO_ADDRESS,
        noteLabel: uniqueNote.label,
        recipient: STRANGER,
        ...countingAllDeposits(poolCover),
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy?.rating).toBe('traceable')
      expect(privacy?.leaks.map(({ id }) => id)).toEqual(['unique-amount'])
      // The 100 hides it, the user's own 37s do not
      expect(privacy?.cover).toEqual({ bigEnough: 1, sameAmount: 0 })
    })

    test("counts another account's deposit of the amount, but not a pending note of the user", () => {
      const poolCover = poolCoverOf([
        poolDeposit(37n, 40n, { label: uniqueNote.label }),
        poolDeposit(37n, 50n)
      ])
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: 37n,
        // Not verified yet, so it is not among the pool's counted deposits either
        notes: [uniqueNote, note({ amount: 37n, depositValue: 37n, approval: 'pending' })],
        tokenAddress: ZERO_ADDRESS,
        noteLabel: uniqueNote.label,
        recipient: STRANGER,
        ...countingAllDeposits(poolCover),
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy?.leaks).toEqual([])
      expect(privacy?.cover.sameAmount).toBe(1)
    })
  })

  describe('fresh deposit', () => {
    test('is weak when the spent deposit was made after the day-ago block', () => {
      const privacy = getWithdrawalPrivacy({ amount: 100n, notes: [note({ blockNumber: 91n })] })

      expect(privacy.rating).toBe('weak')
      expect(summarizeLeaks(privacy)).toEqual([{ id: 'fresh-deposit', amounts: [] }])
    })

    test('is not a leak for a deposit of the day-ago block itself', () => {
      expect(
        getWithdrawalPrivacy({ amount: 100n, notes: [note({ blockNumber: 90n })] }).leaks
      ).toEqual([])
    })

    test('is not a leak when only another deposit of the account is fresh', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 100n,
        notes: [note(), note({ amount: 50n, depositValue: 50n, blockNumber: 95n })]
      })

      expect(privacy.leaks).toEqual([])
    })

    test('lists errors first, then warnings', () => {
      const freshNote = note({ amount: 37n, depositValue: 37n, blockNumber: 91n })
      // The pool's only 37 is the user's fresh one
      const poolCover = poolCoverOf([
        ...POOL_DEPOSITS.filter(({ label }) => label !== OWN_37_LABEL),
        poolDeposit(37n, 91n, { label: freshNote.label })
      ])
      const privacy = getWithdrawalPrivacy({ amount: 37n, notes: [freshNote], poolCover })

      expect(privacy.leaks.map(({ id, type }) => `${type} ${id}`)).toEqual([
        'error unique-amount',
        'warning fresh-deposit'
      ])
    })
  })

  describe('back to the depositor', () => {
    test('is a leak to send part of an unsent deposit back', () => {
      const privacy = getWithdrawalPrivacy({ amount: 40n, notes: [note()], recipient: DEPOSITOR })

      expect(privacy.rating).toBe('weak')
      expect(summarizeLeaks(privacy)).toEqual([{ id: 'send-to-depositor', amounts: [100n] }])
    })

    test('suggests the whole of the deposit spent, not of the others', () => {
      const spentNote = note({ amount: 50n, depositValue: 50n })
      const privacy = getWithdrawalPrivacy({
        amount: 40n,
        notes: [note(), spentNote],
        spentNote,
        recipient: DEPOSITOR
      })

      expect(summarizeLeaks(privacy)).toEqual([{ id: 'send-to-depositor', amounts: [50n] }])
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

      expect(summarizeLeaks(privacy)).toEqual([{ id: 'send-rest-to-depositor', amounts: [] }])
    })

    test('is a leak to send all of a partly sent deposit back, which also empties it', () => {
      const partlySentNote = note({ amount: 60n, withdrawCount: 1 })
      const privacy = getWithdrawalPrivacy({
        amount: 60n,
        notes: [partlySentNote],
        recipient: DEPOSITOR
      })

      expect(summarizeLeaks(privacy)).toEqual([
        { id: 'send-rest-to-depositor', amounts: [] },
        { id: 'empties-partly-sent-deposit', amounts: [] }
      ])
    })

    test('is not a leak to send all of an unsent deposit back', () => {
      const privacy = getWithdrawalPrivacy({ amount: 100n, notes: [note()], recipient: DEPOSITOR })

      expect(privacy.leaks).toEqual([])
    })
  })

  describe('the rest of a partly sent deposit', () => {
    test('is a leak to send all that is left of a deposit earlier sends took part of', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 60n,
        notes: [note({ amount: 60n, withdrawCount: 1 })]
      })

      expect(privacy.rating).toBe('weak')
      expect(summarizeLeaks(privacy)).toEqual([{ id: 'empties-partly-sent-deposit', amounts: [] }])
    })

    test('is not a leak to send only part of what is left, or all of an untouched deposit', () => {
      expect(
        getWithdrawalPrivacy({ amount: 59n, notes: [note({ amount: 60n, withdrawCount: 1 })] })
          .leaks
      ).toEqual([])
      expect(getWithdrawalPrivacy({ amount: 100n, notes: [note()] }).leaks).toEqual([])
    })

    test('checks only the deposit spent, not a partly sent one it leaves alone', () => {
      const spentNote = note({ amount: 50n, depositValue: 50n })
      const privacy = getWithdrawalPrivacy({
        amount: 50n,
        notes: [note({ amount: 60n, withdrawCount: 1 }), spentNote],
        spentNote
      })

      expect(privacy.leaks).toEqual([])
    })
  })

  describe('with no amount yet', () => {
    test('finds no leak of the amount or the deposits, which none is spent from yet', () => {
      // A fresh deposit and a partly sent one, to their depositor, would each leak with an amount
      const notes = [note({ blockNumber: 91n }), note({ amount: 60n, withdrawCount: 1 })]

      const privacy = getWithdrawalPrivacy({ amount: 0n, notes, recipient: DEPOSITOR })
      expect(privacy.leaks).toEqual([])
      expect(privacy.rating).toBe('standard')
      expect(privacy.cover).toEqual({ bigEnough: 0, sameAmount: 0 })
    })

    test('is null for a negative amount', () => {
      const spentNote = note()
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: -1n,
        notes: [spentNote],
        tokenAddress: ZERO_ADDRESS,
        noteLabel: spentNote.label,
        recipient: STRANGER,
        ...countingAllDeposits(POOL_COVER),
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy).toBeNull()
    })
  })

  test('has no privacy for an amount the deposit cannot pay, even if others could together', () => {
    const spentNote = note()

    expect(
      getPrivacyPoolsWithdrawalPrivacy({
        amount: 101n,
        notes: [spentNote, note()],
        tokenAddress: ZERO_ADDRESS,
        noteLabel: spentNote.label,
        recipient: STRANGER,
        ...countingAllDeposits(POOL_COVER),
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
      poolCover: POOL_COVER,
      commonAmounts
    })

  test('rates a common amount standard, hidden by every deposit that could pay all of it', () => {
    const privacy = getDepositPrivacy(50n)

    expect(privacy.rating).toBe('standard')
    expect(privacy.leaks).toEqual([])
    // The two 50s, the two 100s and the 500
    expect(privacy.bigEnough).toBe(5)
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

  test('does not note an amount that only older deposits have', () => {
    const poolCover = poolCoverOf(
      [poolDeposit(42n, 5n), ...[10n, 50n].map((value) => poolDeposit(value, 20n))],
      10n
    )
    const privacy = getPrivacyPoolsDepositPrivacy({
      amount: 42n,
      maxAmount: 1_000n,
      poolCover,
      commonAmounts: COMMON_AMOUNTS
    })

    // Only the 50 in the cover window, as the 42 is too old to count
    expect(privacy.bigEnough).toBe(1)
    expect(privacy.leaks).toEqual([])
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
        poolCover: null,
        commonAmounts: COMMON_AMOUNTS
      })
    ).toEqual({ rating: 'unchecked', leaks: [], bigEnough: 0 })
  })

  test('has no leak before an amount is typed', () => {
    const privacy = getDepositPrivacy(0n, 60n)

    expect(privacy.leaks).toEqual([])
    expect(privacy.rating).toBe('standard')
  })
})

describe('counting only the deposits from Ambire accounts', () => {
  const AMBIRE_USER: Hex = '0x00000000000000000000000000000000000000b1'
  const AMBIRE_OTHER = '0x00000000000000000000000000000000000000b2'
  /** Checked as plain: `DEPOSITOR` and `STRANGER`. Not checked yet: anyone else. */
  const FINGERPRINTS = new Map([
    [AMBIRE_USER, true],
    [AMBIRE_OTHER, true],
    [DEPOSITOR, false],
    [STRANGER, false]
  ])
  // Checksummed, as the notes keep it
  const ambireNote = note({
    amount: 37n,
    depositValue: 37n,
    blockNumber: 10n,
    depositorAddr: '0x00000000000000000000000000000000000000B1'
  })
  const plainNote = note({ amount: 50n, depositValue: 50n, blockNumber: 20n })
  /**
   * The user's 37 from `AMBIRE_USER` and 50 from `DEPOSITOR`, a 37 and a 10 from a stranger, and a
   * 50 and a 100 from another Ambire account. All in the cover window, none fresh.
   */
  const POOL_DEPOSITS_BY_ACCOUNTS = [
    poolDeposit(37n, 10n, { depositor: AMBIRE_USER, label: ambireNote.label }),
    poolDeposit(50n, 20n, { depositor: DEPOSITOR, label: plainNote.label }),
    poolDeposit(37n, 30n),
    poolDeposit(50n, 40n, { depositor: AMBIRE_OTHER }),
    poolDeposit(100n, 50n, { depositor: AMBIRE_OTHER }),
    poolDeposit(10n, 60n)
  ]

  /** A send from `spentNote`, by default the first of `notes`. */
  const getPrivacy = ({
    amount,
    notes,
    spentNote = notes[0]!,
    fingerprints = FINGERPRINTS,
    deposits = POOL_DEPOSITS_BY_ACCOUNTS,
    commonAmounts = COMMON_AMOUNTS
  }: {
    amount: bigint
    notes: PrivacyPoolsNote[]
    spentNote?: PrivacyPoolsNote
    fingerprints?: ReadonlyMap<string, boolean> | null
    deposits?: PrivacyPoolsCoverDeposit[]
    commonAmounts?: bigint[]
  }) =>
    getPrivacyPoolsWithdrawalPrivacy({
      amount,
      notes,
      tokenAddress: ZERO_ADDRESS,
      noteLabel: spentNote.label,
      recipient: STRANGER,
      poolCover: poolCoverOf(deposits),
      fingerprints,
      commonAmounts
    })

  test('counts all deposits when the spent deposit came from a plain address', () => {
    const privacy = getPrivacy({ amount: 37n, notes: [plainNote, ambireNote] })

    // Of at least 37: the stranger's 37, the other 50 and the 100, not the user's own 37. Only
    // Ambire deposits would give 2 and 0
    expect(privacy?.cover).toEqual({ bigEnough: 3, sameAmount: 1 })
  })

  test('counts only Ambire deposits when the spent deposit came from an Ambire account', () => {
    // The account's other deposit came from a plain address, which does not widen the cover
    const privacy = getPrivacy({
      amount: 37n,
      notes: [plainNote, ambireNote],
      spentNote: ambireNote
    })

    // At least 37 among Ambire deposits: the other 50 and the 100, as the user's own 37 hides
    // nobody
    expect(privacy?.cover).toEqual({ bigEnough: 2, sameAmount: 0 })
  })

  test('counts only Ambire deposits when the spent deposit is not checked yet', () => {
    const newNote = note({
      amount: 50n,
      depositValue: 50n,
      depositorAddr: '0x00000000000000000000000000000000000000c1'
    })

    expect(getPrivacy({ amount: 50n, notes: [newNote] })).toMatchObject({
      rating: 'standard',
      cover: { bigEnough: 2, sameAmount: 1 }
    })
  })

  test('leaves out the deposits of others not checked yet, so they never add cover', () => {
    const privacy = getPrivacy({
      amount: 37n,
      notes: [ambireNote],
      deposits: [
        ...POOL_DEPOSITS_BY_ACCOUNTS,
        poolDeposit(37n, 70n, { depositor: '0x00000000000000000000000000000000000000c2' })
      ]
    })

    // The new 37 may well be from an Ambire account, but is not counted until it is checked
    expect(privacy?.leaks.map(({ id }) => id)).toEqual(['unique-amount'])
    expect(privacy?.cover).toEqual({ bigEnough: 2, sameAmount: 0 })
  })

  test('is unchecked before any depositor is checked, never all deposits', () => {
    expect(getPrivacy({ amount: 37n, notes: [ambireNote], fingerprints: null })).toEqual({
      rating: 'unchecked',
      leaks: [],
      cover: { bigEnough: 0, sameAmount: 0 }
    })
    // Even a deposit from a plain address, as nothing tells it is plain yet
    expect(getPrivacy({ amount: 50n, notes: [plainNote], fingerprints: null })?.rating).toBe(
      'unchecked'
    )
  })

  test('checks only the recipient before any depositor is checked and no amount is entered', () => {
    expect(getPrivacy({ amount: 0n, notes: [ambireNote], fingerprints: null })?.rating).toBe(
      'standard'
    )
  })

  test('is traceable when the only other deposits of the amount came from plain addresses', () => {
    const ambirePrivacy = getPrivacy({ amount: 37n, notes: [ambireNote] })
    expect(ambirePrivacy?.rating).toBe('traceable')
    expect(ambirePrivacy?.leaks.map(({ id }) => id)).toEqual(['unique-amount'])

    // The same amount from a plain address hides behind the other 37s
    const plainPrivacy = getPrivacy({
      amount: 37n,
      notes: [note({ amount: 37n, depositValue: 37n, blockNumber: 10n })]
    })
    expect(plainPrivacy?.leaks).toEqual([])
  })

  test('suggests a common amount only when the deposits the spent one hides among have it', () => {
    // The stranger's 10 came from a plain address, so it cannot hide a send from an Ambire deposit
    const withPlainTen = getPrivacy({ amount: 37n, notes: [ambireNote], commonAmounts: [10n] })
    expect(withPlainTen?.leaks.map(({ id }) => id)).toEqual(['unique-amount'])
    expect(withPlainTen?.leaks[0]?.actions).toEqual([])

    const withAmbireTen = getPrivacy({
      amount: 37n,
      notes: [ambireNote],
      commonAmounts: [10n],
      deposits: [...POOL_DEPOSITS_BY_ACCOUNTS, poolDeposit(10n, 70n, { depositor: AMBIRE_OTHER })]
    })
    expect(withAmbireTen?.leaks[0]?.actions.map(({ meta }) => meta.amount)).toEqual([10n])
  })
})
