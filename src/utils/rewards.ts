import { WALLET_TOKEN } from '../consts/addresses'
import {
  NetworkState,
  PortfolioProjectedRewardsResult,
  ProjectedRewardsStats,
  TokenResult
} from '../libs/portfolio/interfaces'

export const calculateRewardsStats = (
  projectedRewardsResult: PortfolioProjectedRewardsResult | undefined,
  walletOrStkWalletTokenPrice: number | undefined
): ProjectedRewardsStats | null => {
  if (!projectedRewardsResult || !walletOrStkWalletTokenPrice) return null

  const { weeksWithData, governanceVotes, rank, poolSize, pointsOfOtherUsers, swapVolume } =
    projectedRewardsResult

  const { averageBalance, liquidityAverage, stkWalletBalanceAverage } = weeksWithData.reduce(
    (acc, week) => {
      acc.averageBalance += week.balance
      acc.liquidityAverage += week.liquidityUsd || 0
      acc.stkWalletBalanceAverage += week.stkWalletUsd || 0

      return acc
    },
    { averageBalance: 0, liquidityAverage: 0, stkWalletBalanceAverage: 0 }
  )

  const numberOfWeeksSinceStartOfSeason =
    projectedRewardsResult.numberOfWeeksSinceStartOfSeason || 1
  const seasonAverageBalance = averageBalance / numberOfWeeksSinceStartOfSeason
  const seasonLiquidityAverage = liquidityAverage / numberOfWeeksSinceStartOfSeason
  const seasonStkWalletBalanceAverage = stkWalletBalanceAverage / numberOfWeeksSinceStartOfSeason

  const balanceScore = Math.floor(seasonAverageBalance / 1000)
  const stkWALLETScore = Math.floor((seasonStkWalletBalanceAverage / 1000) * 20)
  const swapVolumeScore = Math.floor(swapVolume / 2000)
  const liquidityScore = Math.floor((seasonLiquidityAverage / 1000) * 30)
  const governanceWeight = governanceVotes.reduce((acc, vote) => {
    const weight = vote.weight * vote.walletPrice

    return acc + weight
  }, 0)
  const governanceScore = Math.floor(governanceWeight / 2000)
  const totalMultiplier = 1.06 ** projectedRewardsResult.multiplier
  const totalScore = Math.floor(
    (balanceScore + stkWALLETScore + liquidityScore + swapVolumeScore + governanceScore) *
      totalMultiplier
  )

  const estimatedRewardsUSD = Math.floor(
    (totalScore / (pointsOfOtherUsers + totalScore)) * poolSize
  )
  const estimatedRewards = Math.floor(estimatedRewardsUSD / walletOrStkWalletTokenPrice)

  return {
    balanceScore,
    poolSize,
    averageBalance: seasonAverageBalance,
    averageLiquidity: seasonLiquidityAverage,
    averageStkWalletBalance: seasonStkWalletBalanceAverage,
    totalScore,
    rank,
    stkWALLETScore,
    liquidityScore,
    swapVolumeScore,
    swapVolume,
    governanceScore,
    governanceWeight,
    multiplier: totalMultiplier,
    estimatedRewards,
    estimatedRewardsUSD
  }
}

export const getProjectedRewardsStatsAndToken = (
  projectedRewards: NetworkState<PortfolioProjectedRewardsResult> | undefined,
  walletOrStkWalletTokenPrice: number | undefined
):
  | {
      token: TokenResult
      data: ProjectedRewardsStats
    }
  | undefined => {
  if (!projectedRewards) return

  const result = projectedRewards?.result

  if (!result) return

  // take the price of stkWALLET/WALLET if available from portfolio, otherwise WALLET from the relayer
  const walletTokenPrice = walletOrStkWalletTokenPrice || result.walletPrice

  const data = calculateRewardsStats(result, walletTokenPrice)

  if (!data) return

  let estimatedRewardsBothSeasons = data.estimatedRewards

  if (result.frozenRewardSeason1) {
    estimatedRewardsBothSeasons += Math.floor(result.frozenRewardSeason1)
  }

  return {
    token: {
      chainId: BigInt(1),
      amount: BigInt(estimatedRewardsBothSeasons) * BigInt(10 ** 18),
      address: WALLET_TOKEN,
      symbol: 'WALLET',
      name: '$WALLET',
      decimals: 18,
      priceIn: [{ baseCurrency: 'usd', price: walletTokenPrice }],
      flags: {
        onGasTank: false,
        rewardsType: 'wallet-projected-rewards' as const,
        canTopUpGasTank: false,
        isFeeToken: false
      }
    },
    data
  }
}
