import {
  RailgunPoiStatus,
  RailgunShieldedBalance,
  RailgunTokenBalance
} from '../../interfaces/railgun'

/**
 * Mirrors the SDK's rule in `SignerPool.drain`: a note is skipped when
 * `poiStatus !== undefined && poiStatus !== 'Valid'`, so a missing status ('unknown' here, what a
 * POI-disabled provider reports) counts as spendable and everything else does not.
 */
const isSpendablePoiStatus = (poiStatus: RailgunPoiStatus) =>
  poiStatus === 'Valid' || poiStatus === 'unknown'

/**
 * Collapses the SDK's per-(token, POI status) entries into one per token, split by what the user
 * can actually do with it. The split is not cosmetic: a single summed balance makes a freshly
 * shielded (still 'Missing') amount look spendable, and the SDK's note selection then refuses it.
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
