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

  const { weeksWithData, governanceVotes, poolSize, pointsOfOtherUsers, swapVolume } =
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

  const balanceScore = Math.round(seasonAverageBalance / 1000)
  const stkWALLETScore = Math.round((seasonStkWalletBalanceAverage / 1000) * 20)
  const swapVolumeScore = Math.round((swapVolume / 1000) * 10)
  const liquidityScore = Math.round((seasonLiquidityAverage / 1000) * 30)
  const governanceWeight = governanceVotes.reduce((acc, vote) => {
    const weight = vote.weight * vote.walletPrice

    return acc + weight
  }, 0)
  const governanceScore = Math.round(governanceWeight / 2000)
  const totalMultiplier =
    projectedRewardsResult.multiplier === 1 ? 1 : 1.06 ** projectedRewardsResult.multiplier
  const totalScore = Math.round(
    (balanceScore + stkWALLETScore + liquidityScore + swapVolumeScore + governanceScore) *
      totalMultiplier
  )

  const estimatedRewards = Math.round((totalScore / (pointsOfOtherUsers + totalScore)) * poolSize)

  return {
    balanceScore,
    poolSize,
    averageBalance: seasonAverageBalance,
    averageLiquidity: seasonLiquidityAverage,
    averageStkWalletBalance: seasonStkWalletBalanceAverage,
    totalScore,
    stkWALLETScore,
    liquidityScore,
    swapVolumeScore,
    swapVolume,
    governanceScore,
    governanceWeight,
    multiplier: totalMultiplier,
    estimatedRewards,
    estimatedRewardsUSD: estimatedRewards * walletOrStkWalletTokenPrice
  }
}

export const getProjectedRewardsToken = (
  projectedRewards: NetworkState<PortfolioProjectedRewardsResult> | undefined,
  walletOrStkWalletTokenPrice: number | undefined
): TokenResult | undefined => {
  if (!projectedRewards) return

  const result = projectedRewards?.result
  if (!result) return

  // take the price of stkWALLET/WALLET if available from portfolio, otherwise WALLET from the relayer
  const walletTokenPrice = walletOrStkWalletTokenPrice || result.walletPrice

  const { estimatedRewards } = calculateRewardsStats(result, walletTokenPrice) || {}

  return {
    chainId: BigInt(1),
    amount: BigInt(estimatedRewards || 0),
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
  }
}
