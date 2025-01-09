import { formatUnits } from 'ethers'

import { Network } from '../../interfaces/network'
import formatDecimals from '../../utils/formatDecimals/formatDecimals'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import { FormattedPendingAmounts, PendingAmounts, TokenResult } from './interfaces'
import { calculatePendingAmounts } from './pendingAmountsHelper'

const formatPendingAmounts = (
  pendingAmounts: PendingAmounts | null,
  decimals: number,
  priceUSD: number
): FormattedPendingAmounts | null => {
  if (!pendingAmounts) return null

  const pendingBalance = formatUnits(pendingAmounts.pendingBalance, decimals)
  const pendingBalanceUSD =
    priceUSD && pendingAmounts.pendingBalance
      ? safeTokenAmountAndNumberMultiplication(pendingAmounts.pendingBalance, decimals, priceUSD)
      : undefined
  const formattedAmounts: FormattedPendingAmounts = {
    ...pendingAmounts,
    pendingBalance,
    pendingBalanceFormatted: formatDecimals(Number(pendingBalance), 'amount')
  }

  if (pendingBalanceUSD) {
    formattedAmounts.pendingBalanceUSDFormatted = formatDecimals(Number(pendingBalanceUSD), 'value')
  }

  if (pendingAmounts.pendingToBeSigned) {
    formattedAmounts.pendingToBeSignedFormatted = formatDecimals(
      parseFloat(formatUnits(pendingAmounts.pendingToBeSigned, decimals)),
      'amount'
    )
  }

  if (pendingAmounts.pendingToBeConfirmed) {
    formattedAmounts.pendingToBeConfirmedFormatted = formatDecimals(
      parseFloat(formatUnits(pendingAmounts.pendingToBeConfirmed, decimals)),
      'amount'
    )
  }

  return formattedAmounts
}

export const getTokenDetails = (
  {
    flags: { rewardsType },
    networkId,
    priceIn,
    amount,
    decimals,
    amountPostSimulation,
    simulationAmount
  }: TokenResult,
  networks?: Network[],
  tokenAmounts?: {
    latestAmount: bigint
    pendingAmount: bigint
    address: string
    networkId: string
  },
  lastKnownActivityNonce?: bigint,
  lastKnownPortfolioNonce?: bigint
) => {
  const isRewards = rewardsType === 'wallet-rewards'
  const isVesting = rewardsType === 'wallet-vesting'
  const networkData = (networks || []).find(({ id }) => networkId === id)
  const amountish = BigInt(amount)
  const amountishLatest = BigInt(tokenAmounts?.latestAmount || 0n)

  const balance = parseFloat(formatUnits(amountish, decimals))
  const balanceLatest = parseFloat(formatUnits(amountishLatest, decimals))
  const priceUSD = priceIn.find(
    ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
  )?.price
  const balanceUSD = priceUSD
    ? Number(safeTokenAmountAndNumberMultiplication(amountish, decimals, priceUSD))
    : undefined

  const pendingAmountsFormatted = formatPendingAmounts(
    tokenAmounts?.address
      ? calculatePendingAmounts(
          tokenAmounts?.latestAmount,
          tokenAmounts?.pendingAmount,
          amountPostSimulation,
          simulationAmount,
          lastKnownActivityNonce,
          lastKnownPortfolioNonce
        )
      : null,
    decimals,
    priceUSD!
  )

  // 1. This function will be moved to portfolioView.
  // 2. balance, priceUSD and balanceUSD are numbers while values in pendingAmountsFormatted
  // are strings. Please decide on the type of the values when refactoring.
  return {
    balance,
    balanceFormatted: formatDecimals(balance, 'amount'),
    balanceLatestFormatted: formatDecimals(balanceLatest, 'amount'),
    priceUSD,
    priceUSDFormatted: formatDecimals(priceUSD, 'price'),
    balanceUSD,
    balanceUSDFormatted: formatDecimals(balanceUSD, 'value'),
    networkData,
    isRewards,
    isVesting,
    ...pendingAmountsFormatted
  }
}
