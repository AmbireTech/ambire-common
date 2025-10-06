/**
 * Returns the expected rewards and APY
 * @param {number} level - The level from the accumulated xp and the xp they will receive
 * after the 7702 bonus.
 * @param {number[]} balanceSnapshots - All balance snapshots from the relayer.
 * @param {number} currentBalance - The current balance of the user.
 * @param {number} passedWeeks - The number of weeks since the start of the season.
 * @param {number} totalWeightNoUser - The total weight of all users, excluding the weight of the
 * @param {number} minLvl - Minimum required level to get rewards
 * @param {number} minBalance -Minimum required balance in one snapshot o get rewards
 *  current user
 * @returns {Object} Rewards related data.
 * @returns {number} return.walletRewards - The number of $stkWALLET tokens the user will receive.
 * @returns {number } return.apy - The percentage return the user can expect on their current balance in
 * rewards. So if the expected rewards are $10 on $200 balance, then the APY is 5
 */
export function calculateRewardsForSeason(
  level: number,
  balanceSnapshots: number[],
  currentBalance: number,
  passedWeeks: number,
  totalWeightNoUser: number,
  walletPrice: number,
  REWARDS_FOR_SEASON: number,
  minLvl: number,
  mintBalance: number
): { walletRewards: number; apy: number } {
  // required minimum level
  if (level < minLvl) return { apy: 0, walletRewards: 0 }
  // the current balance acts as an additional week snapshot
  // thats why we add it to the list and divide by (passedWeeks + 1)
  const snapshotsAndCur = [...balanceSnapshots, currentBalance]
  if (!snapshotsAndCur.some((x) => x > mintBalance)) return { apy: 0, walletRewards: 0 }

  const sumOfBalances = snapshotsAndCur.reduce((a, b) => a + b, 0)
  const averageBalance = sumOfBalances / (passedWeeks + 1)

  // the weight is calculated with the normal formula
  const weight = Math.sqrt(averageBalance) * level
  // since the current user weight is not included in totalWeightNoUser
  // we simply add it to the denominator and calculate the rewards from it
  const fraction = weight / (weight + totalWeightNoUser)
  const walletRewards = fraction * REWARDS_FOR_SEASON

  // @TODO hardcoded for now, should be passed from the relayer later
  const lengthOfSeasonInYears = 0.5
  // we want to calc the rewards in USD, simply to get the 'APY'
  const yearlyWalletRewards = walletRewards / lengthOfSeasonInYears
  const yearlyRewardsInUsd = yearlyWalletRewards * walletPrice

  const ratioYearlyRewardsToBalance = yearlyRewardsInUsd / currentBalance
  const apy = ratioYearlyRewardsToBalance * 100

  return { apy, walletRewards }
}
