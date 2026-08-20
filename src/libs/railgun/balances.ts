import {
  RailgunPoiStatus,
  RailgunShieldedBalance,
  RailgunTokenBalance
} from '../../interfaces/railgun'

/**
 * Whether a note with this POI status can be spent.
 *
 * Mirrors the SDK's own rule in `SignerPool.drain`, which skips a note when
 * `poiStatus !== undefined && poiStatus !== 'Valid'` - so a missing status ('unknown' here,
 * which is what a POI-disabled provider reports) counts as spendable, and everything else
 * does not.
 */
export const isSpendablePoiStatus = (poiStatus: RailgunPoiStatus) =>
  poiStatus === 'Valid' || poiStatus === 'unknown'

/**
 * Collapses the SDK's per-(token, POI status) balance entries into one entry per token, split
 * by what the user can actually do with it.
 *
 * This split is not cosmetic: showing a single summed balance is what makes a freshly shielded
 * (and therefore still 'Missing') amount look spendable, so the user picks it, submits, and
 * gets `Insufficient balance` straight out of the SDK's note selection.
 */
export const getRailgunTokenBalances = (
  balances: RailgunShieldedBalance[]
): RailgunTokenBalance[] => {
  const byToken = new Map<string, RailgunTokenBalance>()

  balances.forEach(({ tokenAddress, amount, poiStatus }) => {
    const key = tokenAddress.toLowerCase()
    const entry = byToken.get(key) || {
      tokenAddress,
      spendableAmount: 0n,
      pendingAmount: 0n,
      blockedAmount: 0n,
      totalAmount: 0n
    }

    if (isSpendablePoiStatus(poiStatus)) entry.spendableAmount += amount
    else if (poiStatus === 'ShieldBlocked') entry.blockedAmount += amount
    else entry.pendingAmount += amount

    entry.totalAmount += amount
    byToken.set(key, entry)
  })

  return [...byToken.values()]
}

export const getRailgunTokenBalance = (
  balances: RailgunShieldedBalance[],
  tokenAddress: string
): RailgunTokenBalance | undefined =>
  getRailgunTokenBalances(balances).find(
    (balance) => balance.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
  )
