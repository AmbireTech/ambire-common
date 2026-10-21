import { readPrivacyPoolsPoolStats } from './poolStats'

const POOL = '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb'
const OTHER_POOL = '0xb419c2867ab3cbc78921660cb95150d95a94ce86'
const BLOCKS_PER_DAY = 100n
const LAST_SYNCED_BLOCK = 10_000n

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

const read = (storedState: string | null) =>
  readPrivacyPoolsPoolStats({ storedState, poolAddress: POOL, blocksPerDay: BLOCKS_PER_DAY })

describe('readPrivacyPoolsPoolStats', () => {
  test('holds the deposits less the withdrawals and the deposits taken back', () => {
    const stats = read(
      storeState({
        deposits: [
          { label: 1n, value: 100n, blockNumber: 1n },
          { label: 2n, value: 50n, blockNumber: 2n },
          { label: 3n, value: 30n, blockNumber: 3n }
        ],
        withdrawals: [{ value: 40n, blockNumber: 4n }],
        ragequits: [{ label: 3n, value: 30n, blockNumber: 5n }],
        approvedLabels: [1n, 2n]
      })
    )

    expect(stats?.totalAmount).toBe(110n)
    expect(stats?.approvedDepositsCount).toBe(2)
  })

  test('counts only the pool asked for', () => {
    const stats = read(
      storeState({
        deposits: [
          { label: 1n, value: 100n, blockNumber: LAST_SYNCED_BLOCK },
          { label: 2n, value: 999n, blockNumber: LAST_SYNCED_BLOCK, pool: OTHER_POOL }
        ],
        withdrawals: [{ value: 9n, blockNumber: LAST_SYNCED_BLOCK, pool: OTHER_POOL }],
        approvedLabels: [1n, 2n]
      })
    )

    expect(stats).toEqual({
      totalAmount: 100n,
      approvedDepositsCount: 1,
      pendingDepositsCount: 0,
      pendingAmount: 0n,
      depositsCount24h: 1,
      withdrawalsCount24h: 0
    })
  })

  test('counts as pending only unverified deposits made within the review window', () => {
    const reviewStartBlock = LAST_SYNCED_BLOCK - BLOCKS_PER_DAY * 7n
    const stats = read(
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

    expect(stats?.pendingDepositsCount).toBe(2)
    expect(stats?.pendingAmount).toBe(30n)
    expect(stats?.approvedDepositsCount).toBe(1)
  })

  test('counts the deposits and withdrawals of the last day of blocks', () => {
    const lastDayStartBlock = LAST_SYNCED_BLOCK - BLOCKS_PER_DAY
    const stats = read(
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

    expect(stats?.depositsCount24h).toBe(2)
    expect(stats?.withdrawalsCount24h).toBe(1)
  })

  test('has no numbers before the chain is synced', () => {
    expect(read(null)).toBeNull()
    expect(read(storeState({ lastSyncedBlock: 0n }))).toBeNull()
  })

  test('reports an empty pool as empty', () => {
    expect(read(storeState({}))).toEqual({
      totalAmount: 0n,
      approvedDepositsCount: 0,
      pendingDepositsCount: 0,
      pendingAmount: 0n,
      depositsCount24h: 0,
      withdrawalsCount24h: 0
    })
  })

  test('throws on a state it cannot read rather than reporting an empty pool', () => {
    const valid = JSON.parse(storeState({ deposits: [{ label: 1n, value: 1n, blockNumber: 1n }] }))

    expect(() => read(JSON.stringify({ ...valid, asp: {} }))).toThrow('no ASP tree')
    expect(() => read(JSON.stringify({ ...valid, withdrawals: {} }))).toThrow('no withdrawals')
    expect(() => read(JSON.stringify({ ...valid, sync: {} }))).toThrow('last synced block')
    expect(() =>
      read(JSON.stringify({ ...valid, deposits: { depositsTuples: [['0x01', null]] } }))
    ).toThrow('malformed')
    expect(() =>
      read(
        JSON.stringify({
          ...valid,
          deposits: { depositsTuples: [['0x01', { pool: hex(BigInt(POOL)), value: 5 }]] }
        })
      )
    ).toThrow('deposits value')
  })
})
