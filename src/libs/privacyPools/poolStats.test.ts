import {
  getPrivacyPoolsPoolLabels,
  getPrivacyPoolsPoolStats,
  readPrivacyPoolsPoolHistory
} from './poolStats'

const POOL = '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb'
const OTHER_POOL = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'
const SCOPE = 42n
const BLOCKS_PER_DAY = 100n
const LAST_SYNCED_BLOCK = 10_000n

/** The Ethereum ETH pool's scope and the labels of its first two deposits, as on chain. */
const ETH_POOL_SCOPE = 4916574638117198869413701114161172350986437430914933850166949084132905299523n
const ETH_POOL_FIRST_LABELS = [
  17257527664226596860182647181834562990452572441828453844295388934492155844989n,
  20572552624186342001946977043772471280043833801939562344058440297043467610171n
]

const hex = (value: bigint) => `0x${value.toString(16)}`

type Event = { value: bigint; blockNumber: bigint; pool?: string }

/** Events keyed by tuple, numbers as hex strings, each tagged with its pool in `poolField`. */
const tuples = (events: Event[], poolField: 'pool' | 'poolAddress') =>
  events.map(({ value, blockNumber, pool = POOL }, i) => [
    hex(BigInt(i + 1)),
    { value: hex(value), blockNumber: hex(blockNumber), [poolField]: hex(BigInt(pool)) }
  ])

/** The SDK's persisted public state, as it stores it, parsed. */
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
}) => ({
  pools: {
    poolsTuples: [
      [POOL, { address: POOL, scope: hex(SCOPE) }],
      [OTHER_POOL, { address: OTHER_POOL, scope: hex(SCOPE + 1n) }]
    ]
  },
  entrypointDeposits: { entrypointDepositsTuples: tuples(deposits, 'poolAddress') },
  // The pool's own deposits are incomplete, so nothing is read of them
  deposits: { depositsTuples: [] },
  withdrawals: { withdrawalsTuples: tuples(withdrawals, 'pool') },
  ragequits: { ragequitsTuples: tuples(ragequits, 'pool') },
  asp: { leaves: approvedLabels.map(hex), aspTreeRoot: '0x01', blockNumber: '0x01' },
  sync: { lastSyncedBlock: hex(lastSyncedBlock) }
})

const getStats = (state: object, poolLabels: bigint[] = []) =>
  getPrivacyPoolsPoolStats({
    history: readPrivacyPoolsPoolHistory(state, POOL)!,
    blocksPerDay: BLOCKS_PER_DAY,
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
  test("reads only the pool asked for, its deposits from the entrypoint's", () => {
    const history = readPrivacyPoolsPoolHistory(
      storeState({
        deposits: [
          { value: 100n, blockNumber: 5n },
          { value: 999n, blockNumber: 6n, pool: OTHER_POOL }
        ],
        withdrawals: [{ value: 9n, blockNumber: 7n, pool: OTHER_POOL }],
        ragequits: [{ value: 3n, blockNumber: 8n }],
        approvedLabels: [1n, 2n]
      }),
      POOL
    )

    expect(history).toEqual({
      lastSyncedBlock: LAST_SYNCED_BLOCK,
      scope: SCOPE,
      deposits: [{ value: 100n, blockNumber: 5n }],
      withdrawals: [],
      ragequits: [{ value: 3n, blockNumber: 8n }],
      approvedLabels: new Set([1n, 2n])
    })
  })

  test('has no history before the chain is synced', () => {
    expect(readPrivacyPoolsPoolHistory(null, POOL)).toBeNull()
    expect(readPrivacyPoolsPoolHistory(storeState({ lastSyncedBlock: 0n }), POOL)).toBeNull()
  })

  test('throws on a state it cannot read rather than reporting an empty pool', () => {
    const valid = storeState({ deposits: [{ value: 1n, blockNumber: 1n }] })
    const read = (state: object) => () => readPrivacyPoolsPoolHistory(state, POOL)

    expect(read({ ...valid, asp: {} })).toThrow('no ASP tree')
    expect(read({ ...valid, withdrawals: {} })).toThrow('no withdrawals')
    expect(read({ ...valid, entrypointDeposits: {} })).toThrow('no entrypoint deposits')
    expect(read({ ...valid, sync: {} })).toThrow('last synced block')
    expect(read({ ...valid, pools: { poolsTuples: [] } })).toThrow(`no pool ${POOL}`)
    expect(read({ ...valid, ragequits: { ragequitsTuples: [['0x01', null]] } })).toThrow(
      'malformed'
    )
    expect(
      read({
        ...valid,
        entrypointDeposits: {
          entrypointDepositsTuples: [['0x01', { poolAddress: hex(BigInt(POOL)), value: 5 }]]
        }
      })
    ).toThrow('entrypoint deposits value')
  })
})

describe('getPrivacyPoolsPoolStats', () => {
  test('holds what was deposited less what was withdrawn and taken back', () => {
    const stats = getStats(
      storeState({
        deposits: [
          { value: 100n, blockNumber: 1n },
          { value: 50n, blockNumber: 2n }
        ],
        withdrawals: [{ value: 30n, blockNumber: 3n }],
        ragequits: [{ value: 50n, blockNumber: 4n }]
      })
    )

    expect(stats.totalAmount).toBe(70n)
  })

  test("counts verified deposits over the pool's labels, not other pools' in the same tree", () => {
    const stats = getStats(storeState({ approvedLabels: [1n, 2n, 9n] }), [1n, 2n, 3n])

    expect(stats.approvedDepositsCount).toBe(2)
  })

  test('counts the deposits and withdrawals of the last day of blocks', () => {
    const lastDayStartBlock = LAST_SYNCED_BLOCK - BLOCKS_PER_DAY
    const stats = getStats(
      storeState({
        deposits: [
          { value: 1n, blockNumber: lastDayStartBlock },
          { value: 1n, blockNumber: lastDayStartBlock + 1n },
          { value: 1n, blockNumber: LAST_SYNCED_BLOCK }
        ],
        withdrawals: [
          { value: 1n, blockNumber: lastDayStartBlock },
          { value: 1n, blockNumber: LAST_SYNCED_BLOCK }
        ]
      })
    )

    expect(stats.depositsCount24h).toBe(2)
    expect(stats.withdrawalsCount24h).toBe(1)
  })

  test('reports an empty pool as empty', () => {
    expect(getStats(storeState({}))).toEqual({
      totalAmount: 0n,
      approvedDepositsCount: 0,
      depositsCount24h: 0,
      withdrawalsCount24h: 0
    })
  })
})
