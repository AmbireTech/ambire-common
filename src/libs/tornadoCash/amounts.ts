import { TORNADO_CASH_POOLS, TornadoCashPool } from '../../consts/tornadoCash'

/** How many notes of one pool. */
export type TornadoCashNoteCount = {
  pool: TornadoCashPool
  count: number
}

/** The pools of an asset, largest amount first. Empty for an asset Tornado Cash does not hold. */
export const getTornadoCashPoolsOfAsset = (assetAddress: string): TornadoCashPool[] =>
  TORNADO_CASH_POOLS.filter(
    (pool) => pool.assetAddress.toLowerCase() === assetAddress.toLowerCase()
  ).sort((a, b) => (a.denomination > b.denomination ? -1 : 1))

/**
 * Splits an amount into the fewest notes, as the SDK's `MinFee` deposit strategy does, or null when
 * it is no exact sum of the asset's amounts. The SDK would silently keep the remainder out of the
 * deposit, so a send must be refused instead.
 */
export const splitIntoTornadoCashNotes = (
  assetAddress: string,
  amount: bigint
): TornadoCashNoteCount[] | null => {
  const pools = getTornadoCashPoolsOfAsset(assetAddress)
  if (!pools.length || amount <= 0n) return null

  let remaining = amount
  const noteCounts: TornadoCashNoteCount[] = []
  for (const pool of pools) {
    const count = remaining / pool.denomination
    if (count > 0n) {
      noteCounts.push({ pool, count: Number(count) })
      remaining -= count * pool.denomination
    }
  }

  return remaining === 0n ? noteCounts : null
}

/** The total number of notes. */
export const countTornadoCashNotes = (noteCounts: TornadoCashNoteCount[]): number =>
  noteCounts.reduce((sum, { count }) => sum + count, 0)

/**
 * Picks the owned notes that make up exactly `amount`, as the SDK's withdrawal does: largest
 * amounts first, skipping any that would overshoot. Null when no exact pick exists. Exact whenever
 * one exists, as each of an asset's amounts divides the next.
 */
export const pickTornadoCashNotes = (
  ownedNotes: TornadoCashNoteCount[],
  amount: bigint
): TornadoCashNoteCount[] | null => {
  if (amount <= 0n) return null

  const largestFirst = [...ownedNotes].sort((a, b) =>
    a.pool.denomination > b.pool.denomination ? -1 : 1
  )
  let remaining = amount
  const picked: TornadoCashNoteCount[] = []
  for (const { pool, count } of largestFirst) {
    const fitting = remaining / pool.denomination
    const take = fitting < BigInt(count) ? Number(fitting) : count
    if (take > 0) {
      picked.push({ pool, count: take })
      remaining -= BigInt(take) * pool.denomination
    }
  }

  return remaining === 0n ? picked : null
}
