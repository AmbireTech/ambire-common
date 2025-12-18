import { WALLET_TOKEN } from '../consts/addresses'
import {
  NetworkState,
  PortfolioProjectedRewardsResult,
  ProjectedRewardsStats,
  TokenResult
} from '../libs/portfolio/interfaces'

export const calculateRewardsStats = (
  projectedRewardsResult: PortfolioProjectedRewardsResult | undefined,
  walletOrStkWalletTokenPrice: number | undefined,
  currentBalance: number | undefined,
  stkBalanceUsd: number | undefined,
  walletEthProvidedLiquidityInUsd: number | undefined
): ProjectedRewardsStats | null => {
  if (!projectedRewardsResult || !walletOrStkWalletTokenPrice) return null

  const { weeksWithData, governanceVotes, rank, poolSize, pointsOfOtherUsers, swapVolume } =
    projectedRewardsResult

  const { sumBalanceSnapshots, sumLiquiditySnapshots, sumStkBalanceSnapshots } =
    weeksWithData.reduce(
      (acc, week) => {
        acc.sumBalanceSnapshots += week.balance
        acc.sumLiquiditySnapshots += week.liquidityUsd || 0
        acc.sumStkBalanceSnapshots += week.stkWalletUsd || 0

        return acc
      },
      { sumBalanceSnapshots: 0, sumLiquiditySnapshots: 0, sumStkBalanceSnapshots: 0 }
    )
  const numberOfWeeksSinceStartOfSeason =
    projectedRewardsResult.numberOfWeeksSinceStartOfSeason || 1

  const seasonAverageBalance =
    typeof currentBalance !== 'undefined'
      ? (sumBalanceSnapshots + currentBalance) / (numberOfWeeksSinceStartOfSeason + 1)
      : sumBalanceSnapshots / numberOfWeeksSinceStartOfSeason
  const seasonLiquidityAverage =
    typeof walletEthProvidedLiquidityInUsd !== 'undefined'
      ? (sumLiquiditySnapshots + walletEthProvidedLiquidityInUsd) /
        (numberOfWeeksSinceStartOfSeason + 1)
      : sumLiquiditySnapshots / numberOfWeeksSinceStartOfSeason
  const seasonStkWalletBalanceAverage =
    typeof stkBalanceUsd !== 'undefined'
      ? (sumStkBalanceSnapshots + stkBalanceUsd) / (numberOfWeeksSinceStartOfSeason + 1)
      : sumStkBalanceSnapshots / numberOfWeeksSinceStartOfSeason

  const balanceScore = Math.floor(seasonAverageBalance / 1000)
  const stkWALLETScore = Math.floor((seasonStkWalletBalanceAverage / 1000) * 20)
  const swapVolumeScore = Math.floor(swapVolume / 2000)
  const liquidityScore = Math.floor((seasonLiquidityAverage / 1000) * 30)
  const governanceWeight = governanceVotes.reduce((acc, vote) => {
    const weight = vote.weight * vote.walletPrice

    return acc + weight
  }, 0)
  const governanceScore = Math.floor(governanceWeight / 2000)
  const totalMultiplier =
    projectedRewardsResult.multiplier === 1 ? 1 : 1.06 ** projectedRewardsResult.multiplier
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
  walletOrStkWalletTokenPrice: number | undefined,
  currentBalance: number | undefined,
  stkBalanceUsd: number | undefined,
  walletEthProvidedLiquidityInUsd: number | undefined
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

  const data = calculateRewardsStats(
    result,
    walletTokenPrice,
    currentBalance,
    stkBalanceUsd,
    walletEthProvidedLiquidityInUsd
  )

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
