import { PrivacyPoolsPoolStats } from '../../interfaces/privacyPools'

/**
 * How long 0xBow takes at most to verify a deposit. One still not verified after this is taken as
 * declined: on chain it looks the same as one waiting, but 0xBow no longer counts it as pending.
 */
const PENDING_REVIEW_DAYS = 7n

/** A pool event as the SDK persists it, its numbers as hex strings. */
type StoredPoolEvent = { label?: bigint; value: bigint; blockNumber: bigint }

const readBigInt = (value: unknown, field: string): bigint => {
  if (typeof value !== 'string')
    throw new Error(`privacyPools: the stored ${field} is not a number`)

  return BigInt(value)
}

/** A slice's events of one pool. Each tuple is `[key, event]`, the event tagged with its pool. */
const readPoolEvents = (
  tuples: unknown,
  sliceName: string,
  poolAddress: bigint
): StoredPoolEvent[] => {
  if (!Array.isArray(tuples)) throw new Error(`privacyPools: the stored state has no ${sliceName}`)

  return tuples.flatMap((tuple: unknown) => {
    const event = Array.isArray(tuple) ? tuple[1] : null
    if (!event) throw new Error(`privacyPools: a stored ${sliceName} entry is malformed`)
    if (readBigInt(event.pool, `${sliceName} pool`) !== poolAddress) return []

    return [
      {
        label:
          event.label === undefined ? undefined : readBigInt(event.label, `${sliceName} label`),
        value: readBigInt(event.value, `${sliceName} value`),
        blockNumber: readBigInt(event.blockNumber, `${sliceName} block`)
      }
    ]
  })
}

const sumValues = (events: StoredPoolEvent[]) =>
  events.reduce((total, { value }) => total + value, 0n)

/**
 * A pool's numbers from the SDK's persisted public state of its chain (stored under
 * `getPrivacyPoolsStoreKey`): every deposit, withdrawal and taken-back deposit in the pool, and the
 * labels of the verified deposits, as synced in bulk. So nothing is asked of the network, not
 * even which pool the user looks at.
 *
 * As of the last synced block, which also stands in for "now" for the last day's activity.
 * Null before the chain's first sync. Throws if the state is not the shape it reads, so an SDK
 * that changes it fails clearly instead of reporting an empty pool.
 */
export const readPrivacyPoolsPoolStats = ({
  storedState,
  poolAddress,
  blocksPerDay
}: {
  storedState: string | null
  poolAddress: string
  blocksPerDay: bigint
}): PrivacyPoolsPoolStats | null => {
  if (!storedState) return null

  const state = JSON.parse(storedState)
  const lastSyncedBlock = readBigInt(state?.sync?.lastSyncedBlock, 'last synced block')
  if (lastSyncedBlock === 0n) return null

  const pool = BigInt(poolAddress)
  const deposits = readPoolEvents(state.deposits?.depositsTuples, 'deposits', pool)
  const withdrawals = readPoolEvents(state.withdrawals?.withdrawalsTuples, 'withdrawals', pool)
  const ragequits = readPoolEvents(state.ragequits?.ragequitsTuples, 'ragequits', pool)

  const aspLeaves: unknown = state.asp?.leaves
  if (!Array.isArray(aspLeaves)) throw new Error('privacyPools: the stored state has no ASP tree')
  // One tree for all the entrypoint's pools, but labels are unique across them
  const approvedLabels = new Set(aspLeaves.map((leaf) => readBigInt(leaf, 'ASP leaf')))
  const ragequitLabels = new Set(ragequits.map(({ label }) => label))
  const isApproved = ({ label }: StoredPoolEvent) =>
    label !== undefined && approvedLabels.has(label)

  const approvedDeposits = deposits.filter(isApproved)
  const reviewStartBlock = lastSyncedBlock - blocksPerDay * PENDING_REVIEW_DAYS
  const pendingDeposits = deposits.filter(
    (deposit) =>
      deposit.blockNumber > reviewStartBlock &&
      !isApproved(deposit) &&
      !ragequitLabels.has(deposit.label)
  )
  const lastDayStartBlock = lastSyncedBlock - blocksPerDay
  const isInLastDay = ({ blockNumber }: StoredPoolEvent) => blockNumber > lastDayStartBlock

  return {
    totalAmount: sumValues(deposits) - sumValues(withdrawals) - sumValues(ragequits),
    approvedDepositsCount: approvedDeposits.length,
    pendingDepositsCount: pendingDeposits.length,
    pendingAmount: sumValues(pendingDeposits),
    depositsCount24h: deposits.filter(isInLastDay).length,
    withdrawalsCount24h: withdrawals.filter(isInLastDay).length
  }
}
