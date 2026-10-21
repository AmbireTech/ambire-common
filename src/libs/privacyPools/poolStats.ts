import { Interface, JsonRpcProvider, solidityPackedKeccak256 } from 'ethers'

import { PrivacyPoolsPoolStats } from '../../interfaces/privacyPools'

/**
 * How long 0xBow takes at most to verify a deposit. One still not verified after this is taken as
 * declined: on chain it looks the same as one waiting, but 0xBow no longer counts it as pending.
 */
const PENDING_REVIEW_DAYS = 7n

/** The field the pools reduce labels into, BN254's scalar field. */
const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

const POOL_INTERFACE = new Interface([
  'function SCOPE() view returns (uint256)',
  'function nonce() view returns (uint256)'
])
const ERC20_INTERFACE = new Interface(['function balanceOf(address) view returns (uint256)'])

/** A pool event as the SDK persists it, its numbers as hex strings. */
type StoredPoolEvent = { label?: bigint; value: bigint; blockNumber: bigint }

/** One pool's part of the SDK's persisted public state of its chain. */
export type PrivacyPoolsPoolHistory = {
  lastSyncedBlock: bigint
  deposits: StoredPoolEvent[]
  withdrawals: StoredPoolEvent[]
  ragequits: StoredPoolEvent[]
  /** Labels of the verified deposits, of all the entrypoint's pools. */
  approvedLabels: Set<bigint>
}

/** What a pool's numbers need from the chain, as the persisted state can't be trusted for them. */
export type PrivacyPoolsPoolOnchainState = {
  scope: bigint
  /** What the pool holds. */
  balance: bigint
  /** Deposits ever made: each one's label is derived from it, see `getPrivacyPoolsPoolLabels`. */
  depositsCount: bigint
}

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
 * A pool's history from the SDK's persisted public state of its chain (stored under
 * `getPrivacyPoolsStoreKey`): every deposit, withdrawal and taken-back deposit in the pool, and the
 * labels of the verified deposits, as synced in bulk. So nothing is asked of the network, not
 * even which pool the user looks at.
 *
 * Its deposits are incomplete: the SDK keys them by precommitment, which some deposits share, and
 * keeps only the last of each. So what the pool holds and how many deposits are verified are read
 * from the chain instead - see `getPrivacyPoolsPoolStats`.
 *
 * Null before the chain's first sync. Throws if the state is not the shape it reads, so an SDK
 * that changes it fails clearly instead of reporting an empty pool.
 */
export const readPrivacyPoolsPoolHistory = (
  storedState: string | null,
  poolAddress: string
): PrivacyPoolsPoolHistory | null => {
  if (!storedState) return null

  const state = JSON.parse(storedState)
  const lastSyncedBlock = readBigInt(state?.sync?.lastSyncedBlock, 'last synced block')
  if (lastSyncedBlock === 0n) return null

  const pool = BigInt(poolAddress)
  const aspLeaves: unknown = state.asp?.leaves
  if (!Array.isArray(aspLeaves)) throw new Error('privacyPools: the stored state has no ASP tree')

  return {
    lastSyncedBlock,
    deposits: readPoolEvents(state.deposits?.depositsTuples, 'deposits', pool),
    withdrawals: readPoolEvents(state.withdrawals?.withdrawalsTuples, 'withdrawals', pool),
    ragequits: readPoolEvents(state.ragequits?.ragequitsTuples, 'ragequits', pool),
    // One tree for all the entrypoint's pools, but labels are unique across them
    approvedLabels: new Set(aspLeaves.map((leaf) => readBigInt(leaf, 'ASP leaf')))
  }
}

/**
 * The labels of a pool's deposits from `fromNonce` (1 for the first deposit) to `toNonce`, as the
 * pool derives them: `keccak256(abi.encodePacked(SCOPE, nonce)) % SNARK_SCALAR_FIELD`. Complete,
 * unlike the deposits the SDK persists.
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

/** Reads what a pool's numbers need from the chain. */
export const readPrivacyPoolsPoolOnchainState = async ({
  provider,
  poolAddress,
  assetAddress,
  isNative
}: {
  provider: JsonRpcProvider
  poolAddress: string
  assetAddress: string
  isNative: boolean
}): Promise<PrivacyPoolsPoolOnchainState> => {
  const callPool = async (method: 'SCOPE' | 'nonce') =>
    BigInt(
      POOL_INTERFACE.decodeFunctionResult(
        method,
        await provider.call({ to: poolAddress, data: POOL_INTERFACE.encodeFunctionData(method) })
      )[0]
    )
  const readBalance = async () => {
    if (isNative) return provider.getBalance(poolAddress)

    const data = await provider.call({
      to: assetAddress,
      data: ERC20_INTERFACE.encodeFunctionData('balanceOf', [poolAddress])
    })

    return BigInt(ERC20_INTERFACE.decodeFunctionResult('balanceOf', data)[0])
  }

  const [scope, depositsCount, balance] = await Promise.all([
    callPool('SCOPE'),
    callPool('nonce'),
    readBalance()
  ])

  return { scope, depositsCount, balance }
}

/**
 * A pool's numbers. What it holds is its balance, and verified deposits are counted over the
 * labels derived from the chain, as the persisted deposits miss some (see
 * `readPrivacyPoolsPoolHistory`). The rest comes from the persisted history, as of its last synced
 * block, which also stands in for "now" for the last day's activity: the deposits it misses are
 * old ones, from 2025.
 */
export const getPrivacyPoolsPoolStats = ({
  history,
  blocksPerDay,
  poolBalance,
  poolLabels
}: {
  history: PrivacyPoolsPoolHistory
  blocksPerDay: bigint
  poolBalance: bigint
  poolLabels: bigint[]
}): PrivacyPoolsPoolStats => {
  const { lastSyncedBlock, deposits, withdrawals, ragequits, approvedLabels } = history
  const ragequitLabels = new Set(ragequits.map(({ label }) => label))
  const isApproved = ({ label }: StoredPoolEvent) =>
    label !== undefined && approvedLabels.has(label)

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
    totalAmount: poolBalance,
    approvedDepositsCount: poolLabels.filter((label) => approvedLabels.has(label)).length,
    pendingDepositsCount: pendingDeposits.length,
    pendingAmount: sumValues(pendingDeposits),
    depositsCount24h: deposits.filter(isInLastDay).length,
    withdrawalsCount24h: withdrawals.filter(isInLastDay).length
  }
}
