import { Hex } from '../../../interfaces/hex'
import { PrivacyPoolsNote } from '../../../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../../../services/socket/constants'
import { PrivacyPoolsCoverDeposit, PrivacyPoolsPoolCover } from '../poolStats'
import { getPrivacyPoolsNotesToSpend } from './helpers'
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

/** A pool of `deposits`, all recent, of which those after block 90 are fresh. */
const poolCoverOf = (
  deposits: PrivacyPoolsCoverDeposit[],
  recentAfterBlock = 0n
): PrivacyPoolsPoolCover => ({ deposits, recentAfterBlock, freshAfterBlock: 90n })

/**
 * The pool: three of 10, two of 50 and of 100, one each of 37 and 500, oldest first, at blocks 10
 * to 90. All are recent, and none is fresh.
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

const getWithdrawalPrivacy = ({
  amount,
  notes,
  recipient = STRANGER,
  poolCover = POOL_COVER
}: {
  amount: bigint
  notes: PrivacyPoolsNote[]
  recipient?: string | null
  poolCover?: PrivacyPoolsPoolCover
}) => {
  const privacy = getPrivacyPoolsWithdrawalPrivacy({
    amount,
    notes,
    tokenAddress: ZERO_ADDRESS,
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
    const privacy = getWithdrawalPrivacy({ amount: 60n, notes: [note({ label: OWN_100_LABEL })] })

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
        ...countingAllDeposits(null),
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

    test('is traceable when it is one of several notes spent', () => {
      const privacy = getWithdrawalPrivacy({ amount: 137n, notes: [note(), uniqueNote] })

      expect(privacy.rating).toBe('traceable')
      // The only 37 is the user's own
      expect(privacy.cover.sameAmount).toBe(0)
      expect(privacy.leaks.map(({ id }) => id)).toEqual(['unique-amount'])
    })

    test('counts an old deposit of the user, so one recent deposit of the amount still hides it', () => {
      // The user's 37 at block 40 is older than the recent ones, the other 37 at block 90 is not
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
        recipient: STRANGER,
        ...countingAllDeposits(poolCover),
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

      expect(privacy.leaks.map(({ id }) => id)).toEqual(['fresh-deposit'])
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

    test('suggests the whole of the deposit taken part of, after the ones taken whole', () => {
      const privacy = getWithdrawalPrivacy({
        amount: 120n,
        notes: [note(), note({ amount: 50n, depositValue: 50n })],
        recipient: DEPOSITOR
      })

      expect(summarizeLeaks(privacy)).toEqual([{ id: 'send-to-depositor', amounts: [150n] }])
    })

    test('suggests nothing when a deposit that earlier sends took part of still goes back', () => {
      // The whole of the untouched 50 would still send the partly sent 60 back
      const privacy = getWithdrawalPrivacy({
        amount: 80n,
        notes: [note({ amount: 60n, withdrawCount: 1 }), note({ amount: 50n, depositValue: 50n })],
        recipient: DEPOSITOR
      })

      expect(summarizeLeaks(privacy)).toEqual([
        { id: 'send-to-depositor', amounts: [] },
        { id: 'send-rest-to-depositor', amounts: [] }
      ])
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

    test('is a leak to send all of a partly sent deposit back', () => {
      const partlySentNote = note({ amount: 60n, withdrawCount: 1 })
      const privacy = getWithdrawalPrivacy({
        amount: 60n,
        notes: [partlySentNote],
        recipient: DEPOSITOR
      })

      expect(summarizeLeaks(privacy)).toEqual([{ id: 'send-rest-to-depositor', amounts: [] }])
    })

    test('is not a leak to send all of an unsent deposit back', () => {
      const privacy = getWithdrawalPrivacy({ amount: 100n, notes: [note()], recipient: DEPOSITOR })

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
      expect(privacy.notesCount).toBe(0)
    })

    test('is null for a negative amount', () => {
      const privacy = getPrivacyPoolsWithdrawalPrivacy({
        amount: -1n,
        notes: [note()],
        tokenAddress: ZERO_ADDRESS,
        recipient: STRANGER,
        ...countingAllDeposits(POOL_COVER),
        commonAmounts: COMMON_AMOUNTS
      })

      expect(privacy).toBeNull()
    })
  })

  test('has no privacy for an amount the notes cannot pay', () => {
    expect(
      getPrivacyPoolsWithdrawalPrivacy({
        amount: 101n,
        notes: [note()],
        tokenAddress: ZERO_ADDRESS,
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

    // Only the recent 50, as the 42 is too old to count
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
   * 50 and a 100 from another Ambire account. All recent, none fresh.
   */
  const POOL_DEPOSITS_BY_ACCOUNTS = [
    poolDeposit(37n, 10n, { depositor: AMBIRE_USER, label: ambireNote.label }),
    poolDeposit(50n, 20n, { depositor: DEPOSITOR, label: plainNote.label }),
    poolDeposit(37n, 30n),
    poolDeposit(50n, 40n, { depositor: AMBIRE_OTHER }),
    poolDeposit(100n, 50n, { depositor: AMBIRE_OTHER }),
    poolDeposit(10n, 60n)
  ]

  const getPrivacy = ({
    amount,
    notes,
    fingerprints = FINGERPRINTS,
    deposits = POOL_DEPOSITS_BY_ACCOUNTS,
    commonAmounts = COMMON_AMOUNTS
  }: {
    amount: bigint
    notes: PrivacyPoolsNote[]
    fingerprints?: ReadonlyMap<string, boolean> | null
    deposits?: PrivacyPoolsCoverDeposit[]
    commonAmounts?: bigint[]
  }) =>
    getPrivacyPoolsWithdrawalPrivacy({
      amount,
      notes,
      tokenAddress: ZERO_ADDRESS,
      recipient: STRANGER,
      poolCover: poolCoverOf(deposits),
      fingerprints,
      commonAmounts
    })

  test('counts all deposits when every spent deposit came from a plain address', () => {
    // Paid from the plain 50 alone, as it comes first
    const privacy = getPrivacy({ amount: 37n, notes: [plainNote, ambireNote] })

    // Of at least 37: the stranger's 37, the other 50 and the 100, not the user's own 37. Only
    // Ambire deposits would give 2 and 0
    expect(privacy?.cover).toEqual({ bigEnough: 3, sameAmount: 1 })
  })

  test('counts only Ambire deposits when one spent deposit came from an Ambire account', () => {
    // Spends the plain 50 whole, then the Ambire 37 whole
    const privacy = getPrivacy({ amount: 87n, notes: [plainNote, ambireNote] })

    // At least 50 among Ambire deposits: the other 50 and the 100. At least 37: the same two, as
    // the user's own 37 hides nobody
    expect(privacy?.cover).toEqual({ bigEnough: 2, sameAmount: 0 })
  })

  test('counts only Ambire deposits when a spent deposit is not checked yet', () => {
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
      cover: { bigEnough: 0, sameAmount: 0 },
      notesCount: 1
    })
    // Even a deposit from a plain address, as nothing tells it is plain yet
    expect(getPrivacy({ amount: 50n, notes: [plainNote], fingerprints: null })?.rating).toBe(
      'unchecked'
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

  test('suggests a common amount by the deposits its own spends hide among', () => {
    // Spends both deposits whole, so the Ambire 37 hides only among Ambire deposits
    const privacy = getPrivacy({
      amount: 87n,
      notes: [ambireNote, plainNote],
      commonAmounts: [10n]
    })

    expect(privacy?.leaks.map(({ id }) => id)).toEqual(['unique-amount'])
    // A send of 10 spends only the plain 50, so the stranger's 10 hides it
    expect(privacy?.leaks[0]?.actions.map(({ meta }) => meta.amount)).toEqual([10n])
  })
})
