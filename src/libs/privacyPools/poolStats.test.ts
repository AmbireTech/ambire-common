import {
  getPrivacyPoolsPoolLabels,
  getPrivacyPoolsPoolStats,
  readPrivacyPoolsPoolHistory
} from './poolStats'

const POOL = '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb'
const OTHER_POOL = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'
const BLOCKS_PER_DAY = 100n
const LAST_SYNCED_BLOCK = 10_000n

/** The Ethereum ETH pool's scope and the labels of its first two deposits, as on chain. */
const ETH_POOL_SCOPE = 4916574638117198869413701114161172350986437430914933850166949084132905299523n
const ETH_POOL_FIRST_LABELS = [
  17257527664226596860182647181834562990452572441828453844295388934492155844989n,
  20572552624186342001946977043772471280043833801939562344058440297043467610171n
]

const hex = (value: bigint) => `0x${value.toString(16)}`

type Event = { label?: bigint; value: bigint; blockNumber: bigint; pool?: string }

const tuples = (events: Event[]) =>
  events.map(({ label, value, blockNumber, pool = POOL }, i) => [
    hex(BigInt(i + 1)),
    {
      ...(label === undefined ? {} : { label: hex(label) }),
      value: hex(value),
      blockNumber: hex(blockNumber),
      pool: hex(BigInt(pool))
    }
  ])

/** The SDK's persisted public state: events keyed by tuple, numbers as hex strings. */
const storeState = ({
  deposits = [],
  withdrawals = [],
  ragequits = [],
  approvedLabels = [],
  lastSyncedBlock = LAST_SYNCED_BLOCK
}: {
  deposits?: Event[]
  withdrawals?: Event[]
  ragequits?: Event[]
  approvedLabels?: bigint[]
  lastSyncedBlock?: bigint
}) =>
  JSON.stringify({
    deposits: { depositsTuples: tuples(deposits) },
    withdrawals: { withdrawalsTuples: tuples(withdrawals) },
    ragequits: { ragequitsTuples: tuples(ragequits) },
    asp: { leaves: approvedLabels.map(hex), aspTreeRoot: '0x01', blockNumber: '0x01' },
    sync: { lastSyncedBlock: hex(lastSyncedBlock) }
  })

const getStats = (
  storedState: string,
  { poolBalance = 0n, poolLabels = [] }: { poolBalance?: bigint; poolLabels?: bigint[] } = {}
) =>
  getPrivacyPoolsPoolStats({
    history: readPrivacyPoolsPoolHistory(storedState, POOL)!,
    blocksPerDay: BLOCKS_PER_DAY,
    poolBalance,
    poolLabels
  })

describe('getPrivacyPoolsPoolLabels', () => {
  test("derives a pool's labels from its scope and the deposits' nonces, as the pool does", () => {
    expect(getPrivacyPoolsPoolLabels(ETH_POOL_SCOPE, 1n, 2n)).toEqual(ETH_POOL_FIRST_LABELS)
    expect(getPrivacyPoolsPoolLabels(ETH_POOL_SCOPE, 2n, 2n)).toEqual([ETH_POOL_FIRST_LABELS[1]])
  })

  test('derives none for an empty range', () => {
    expect(getPrivacyPoolsPoolLabels(ETH_POOL_SCOPE, 1n, 0n)).toEqual([])
  })
})

describe('readPrivacyPoolsPoolHistory', () => {
  test('reads only the pool asked for', () => {
    const history = readPrivacyPoolsPoolHistory(
      storeState({
        deposits: [
          { label: 1n, value: 100n, blockNumber: 5n },
          { label: 2n, value: 999n, blockNumber: 6n, pool: OTHER_POOL }
        ],
        withdrawals: [{ value: 9n, blockNumber: 7n, pool: OTHER_POOL }],
        approvedLabels: [1n, 2n]
      }),
      POOL
    )

    expect(history).toEqual({
      lastSyncedBlock: LAST_SYNCED_BLOCK,
      deposits: [{ label: 1n, value: 100n, blockNumber: 5n }],
      withdrawals: [],
      ragequits: [],
      approvedLabels: new Set([1n, 2n])
    })
  })

  test('has no history before the chain is synced', () => {
    expect(readPrivacyPoolsPoolHistory(null, POOL)).toBeNull()
    expect(readPrivacyPoolsPoolHistory(storeState({ lastSyncedBlock: 0n }), POOL)).toBeNull()
  })

  test('throws on a state it cannot read rather than reporting an empty pool', () => {
    const valid = JSON.parse(storeState({ deposits: [{ label: 1n, value: 1n, blockNumber: 1n }] }))
    const read = (state: object) => () => readPrivacyPoolsPoolHistory(JSON.stringify(state), POOL)

    expect(read({ ...valid, asp: {} })).toThrow('no ASP tree')
    expect(read({ ...valid, withdrawals: {} })).toThrow('no withdrawals')
    expect(read({ ...valid, sync: {} })).toThrow('last synced block')
    expect(read({ ...valid, deposits: { depositsTuples: [['0x01', null]] } })).toThrow('malformed')
    expect(
      read({
        ...valid,
        deposits: { depositsTuples: [['0x01', { pool: hex(BigInt(POOL)), value: 5 }]] }
      })
    ).toThrow('deposits value')
  })
})

describe('getPrivacyPoolsPoolStats', () => {
  test("holds the pool's balance, not what the stored deposits add up to", () => {
    const stats = getStats(
      storeState({ deposits: [{ label: 1n, value: 100n, blockNumber: 1n }] }),
      {
        poolBalance: 422n
      }
    )

    expect(stats.totalAmount).toBe(422n)
  })

  test("counts verified deposits over the pool's labels, also the ones missing from the history", () => {
    const stats = getStats(
      storeState({
        // The SDK kept only one of the deposits sharing a precommitment
        deposits: [{ label: 1n, value: 100n, blockNumber: 1n }],
        // Another pool's verified deposit is in the same tree
        approvedLabels: [1n, 2n, 9n]
      }),
      { poolLabels: [1n, 2n, 3n] }
    )

    expect(stats.approvedDepositsCount).toBe(2)
  })

  test('counts as pending only unverified deposits made within the review window', () => {
    const reviewStartBlock = LAST_SYNCED_BLOCK - BLOCKS_PER_DAY * 7n
    const stats = getStats(
      storeState({
        deposits: [
          { label: 1n, value: 10n, blockNumber: LAST_SYNCED_BLOCK },
          { label: 2n, value: 20n, blockNumber: reviewStartBlock + 1n },
          // Too old to still be reviewed: declined, not pending
          { label: 3n, value: 40n, blockNumber: reviewStartBlock },
          // Verified
          { label: 4n, value: 80n, blockNumber: LAST_SYNCED_BLOCK },
          // Taken back before it was verified
          { label: 5n, value: 160n, blockNumber: LAST_SYNCED_BLOCK }
        ],
        ragequits: [{ label: 5n, value: 160n, blockNumber: LAST_SYNCED_BLOCK }],
        approvedLabels: [4n]
      })
    )

    expect(stats.pendingDepositsCount).toBe(2)
    expect(stats.pendingAmount).toBe(30n)
  })

  test('counts the deposits and withdrawals of the last day of blocks', () => {
    const lastDayStartBlock = LAST_SYNCED_BLOCK - BLOCKS_PER_DAY
    const stats = getStats(
      storeState({
        deposits: [
          { label: 1n, value: 1n, blockNumber: lastDayStartBlock },
          { label: 2n, value: 1n, blockNumber: lastDayStartBlock + 1n },
          { label: 3n, value: 1n, blockNumber: LAST_SYNCED_BLOCK }
        ],
        withdrawals: [
          { value: 1n, blockNumber: lastDayStartBlock },
          { value: 1n, blockNumber: LAST_SYNCED_BLOCK }
        ],
        approvedLabels: [1n, 2n, 3n]
      })
    )

    expect(stats.depositsCount24h).toBe(2)
    expect(stats.withdrawalsCount24h).toBe(1)
  })

  test('reports an empty pool as empty', () => {
    expect(getStats(storeState({}))).toEqual({
      totalAmount: 0n,
      approvedDepositsCount: 0,
      pendingDepositsCount: 0,
      pendingAmount: 0n,
      depositsCount24h: 0,
      withdrawalsCount24h: 0
    })
  })
})
