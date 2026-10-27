import { solidityPackedKeccak256 } from 'ethers'

import { PrivacyPoolsPoolStats } from '../../interfaces/privacyPools'

/** The field the pools reduce labels into, BN254's scalar field. */
const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** An event of a pool as the SDK persists it: what it moved and when. */
type StoredPoolEvent = { value: bigint; blockNumber: bigint }

/** One pool's part of the SDK's persisted public state of its chain. */
export type PrivacyPoolsPoolHistory = {
  lastSyncedBlock: bigint
  /** What each deposit's label is derived from - see `getPrivacyPoolsPoolLabels`. */
  scope: bigint
  /** Every deposit, as the entrypoint reported it, each one's value after the vetting fee. */
  deposits: StoredPoolEvent[]
  withdrawals: StoredPoolEvent[]
  ragequits: StoredPoolEvent[]
  /** Labels of the verified deposits, of all the entrypoint's pools. */
  approvedLabels: Set<bigint>
}

const readBigInt = (value: unknown, field: string): bigint => {
  if (typeof value !== 'string')
    throw new Error(`privacyPools: the stored ${field} is not a number`)

  return BigInt(value)
}

/** A slice's entries. Each tuple is `[key, entry]`. */
const readEntries = (tuples: unknown, sliceName: string): any[] => {
  if (!Array.isArray(tuples)) throw new Error(`privacyPools: the stored state has no ${sliceName}`)

  return tuples.map((tuple: unknown) => {
    const entry = Array.isArray(tuple) ? tuple[1] : null
    if (!entry) throw new Error(`privacyPools: a stored ${sliceName} entry is malformed`)

    return entry
  })
}

/** A slice's events of one pool, each tagged with its pool in `poolField`. */
const readPoolEvents = (
  tuples: unknown,
  sliceName: string,
  poolField: 'pool' | 'poolAddress',
  poolAddress: bigint
): StoredPoolEvent[] =>
  readEntries(tuples, sliceName).flatMap((event) => {
    if (readBigInt(event[poolField], `${sliceName} pool`) !== poolAddress) return []

    return [
      {
        value: readBigInt(event.value, `${sliceName} value`),
        blockNumber: readBigInt(event.blockNumber, `${sliceName} block`)
      }
    ]
  })

const sumValues = (events: StoredPoolEvent[]) =>
  events.reduce((total, { value }) => total + value, 0n)

/**
 * A pool's history from the SDK's persisted public state of its chain (stored under
 * `getPrivacyPoolsStoreKey`): its scope, every deposit, withdrawal and taken-back deposit in the
 * pool, and the labels of the verified deposits, as synced in bulk. So nothing is asked of the
 * network, not even which pool the user looks at.
 *
 * Deposits are the entrypoint's, keyed by commitment, not the pool's, which the SDK keys by
 * precommitment: some deposits share one (822 in the Ethereum ETH pool, from 2025), and only the
 * last of each is kept.
 *
 * Null before the chain's first sync (no state, or one not synced yet). Throws if the state is not the shape it reads, so an SDK
 * that changes it fails clearly instead of reporting an empty pool.
 */
export const readPrivacyPoolsPoolHistory = (
  /** The persisted state, parsed once for all the chain's pools. */
  state: any,
  poolAddress: string
): PrivacyPoolsPoolHistory | null => {
  if (!state) return null

  const lastSyncedBlock = readBigInt(state?.sync?.lastSyncedBlock, 'last synced block')
  if (lastSyncedBlock === 0n) return null

  const pool = BigInt(poolAddress)
  const registeredPool = readEntries(state.pools?.poolsTuples, 'pools').find(
    ({ address }) => readBigInt(address, 'pool address') === pool
  )
  if (!registeredPool) throw new Error(`privacyPools: the stored state has no pool ${poolAddress}`)

  const aspLeaves: unknown = state.asp?.leaves
  if (!Array.isArray(aspLeaves)) throw new Error('privacyPools: the stored state has no ASP tree')

  return {
    lastSyncedBlock,
    scope: readBigInt(registeredPool.scope, 'pool scope'),
    deposits: readPoolEvents(
      state.entrypointDeposits?.entrypointDepositsTuples,
      'entrypoint deposits',
      'poolAddress',
      pool
    ),
    withdrawals: readPoolEvents(state.withdrawals?.withdrawalsTuples, 'withdrawals', 'pool', pool),
    ragequits: readPoolEvents(state.ragequits?.ragequitsTuples, 'ragequits', 'pool', pool),
    // One tree for all the entrypoint's pools, but labels are unique across them
    approvedLabels: new Set(aspLeaves.map((leaf) => readBigInt(leaf, 'ASP leaf')))
  }
}

/**
 * The labels of a pool's deposits from `fromNonce` (1 for the first deposit) to `toNonce`, as the
 * pool derives them: `keccak256(abi.encodePacked(SCOPE, nonce)) % SNARK_SCALAR_FIELD`. A pool's
 * nonce is its deposits count, so its labels are those up to `deposits.length`.
 */
export const getPrivacyPoolsPoolLabels = (
  scope: bigint,
  fromNonce: bigint,
  toNonce: bigint
): bigint[] => {
  const labels: bigint[] = []
  for (let nonce = fromNonce; nonce <= toNonce; nonce++) {
    labels.push(
      BigInt(solidityPackedKeccak256(['uint256', 'uint256'], [scope, nonce])) % SNARK_SCALAR_FIELD
    )
  }

  return labels
}

/**
 * A pool's numbers, as of the history's last synced block, which also stands in for "now" for
 * the last day's activity. What it holds is what was deposited less what left it, so it misses
 * only tokens sent to the pool directly, outside any deposit.
 */
export const getPrivacyPoolsPoolStats = ({
  history,
  blocksPerDay,
  poolLabels
}: {
  history: PrivacyPoolsPoolHistory
  blocksPerDay: bigint
  /** The labels of all the pool's deposits - see `getPrivacyPoolsPoolLabels`. */
  poolLabels: bigint[]
}): PrivacyPoolsPoolStats => {
  const { lastSyncedBlock, deposits, withdrawals, ragequits, approvedLabels } = history
  const lastDayStartBlock = lastSyncedBlock - blocksPerDay
  const isInLastDay = ({ blockNumber }: StoredPoolEvent) => blockNumber > lastDayStartBlock

  return {
    totalAmount: sumValues(deposits) - sumValues(withdrawals) - sumValues(ragequits),
    approvedDepositsCount: poolLabels.filter((label) => approvedLabels.has(label)).length,
    depositsCount24h: deposits.filter(isInLastDay).length,
    withdrawalsCount24h: withdrawals.filter(isInLastDay).length
  }
}
