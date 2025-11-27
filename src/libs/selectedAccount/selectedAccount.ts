import { WALLET_TOKEN } from '../../consts/addresses'
import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState
} from '../../interfaces/selectedAccount'
import { calculateRewardsForSeason } from '../../utils/rewards'
import {
  AccountState,
  NetworkState,
  PortfolioProjectedRewardsResult,
  ProjectedRewardsTokenResult
} from '../portfolio/interfaces'

// const isTokenPriceWithinHalfPercent = (price1: number, price2: number): boolean => {
//   const diff = Math.abs(price1 - price2)
//   const threshold = 0.005 * Math.max(Math.abs(price1), Math.abs(price2))
//   return diff <= threshold
// }

export const isInternalChain = (chainId: string) => {
  return chainId === 'gasTank' || chainId === 'rewards' || chainId === 'projectedRewards'
}

/**
 * Adds the defi positions tokens that aren't handled by the portfolio.
 * Also calculates the total balance of the defi positions so it can be added to the total balance.
 */
// @TODO: Refactor and migrate to the portfolio
// export const calculateDefiPositions = (
//   chainId: string,
//   portfolioTokens: (TokenResult & {
//     latestAmount?: bigint
//     pendingAmount?: bigint
//   })[],
//   defiPositionsAccountState?: DefiPositionsAccountState
// ): {
//   defiPositionsBalance: number
//   tokens: (TokenResult & {
//     latestAmount?: bigint
//     pendingAmount?: bigint
//   })[]
// } | null => {
//   const areDefiPositionsNotInitialized =
//     !defiPositionsAccountState || Object.keys(defiPositionsAccountState).length === 0

//   if (isInternalChain(chainId) || areDefiPositionsNotInitialized) {
//     return null
//   }

//   const defiPositionsNetworkState = defiPositionsAccountState[chainId]

//   const tokens = portfolioTokens
//   let networkBalance = 0
//   const positions = defiPositionsNetworkState || {}

//   positions.positionsByProvider?.forEach((posByProv: PositionsByProvider) => {
//     posByProv.positions.forEach((pos) => {
//       if (pos.additionalData?.pool?.controller) {
//         const tokenInPortfolio = tokens.find((t) => {
//           return (
//             t.address.toLowerCase() ===
//               (pos.additionalData?.pool?.controller || '').toLowerCase() &&
//             t.chainId.toString() === chainId &&
//             !t.flags.rewardsType &&
//             !t.flags.onGasTank
//           )
//         })

//         // Skip if the controller token is already in the portfolio and has a price in USD
//         // (custom tokens with no price can be added. In that case add the pos to the total balance)
//         if (
//           tokenInPortfolio &&
//           tokenInPortfolio.amount !== 0n &&
//           tokenInPortfolio.priceIn.find((p) => p.baseCurrency === 'usd' && p.price !== 0) &&
//           !tokenInPortfolio.flags.isHidden
//         )
//           return
//       }

//       let shouldAddPositionUSDAmountToTheTotalBalance = true

//       pos.assets.filter(Boolean).forEach((a) => {
//         // if this "if" is ever removed, ensure that the defiTokenType flag is set correctly
//         // for these asset types
//         if (a.type === AssetType.Liquidity || a.type === AssetType.Reward) return

//         if (a.protocolAsset && a.protocolAsset?.name) {
//           const protocolTokenInPortfolio = tokens.find((t) => {
//             return (
//               t.address.toLowerCase() === (a.protocolAsset?.address || '').toLowerCase() &&
//               t.chainId.toString() === chainId &&
//               !t.flags.rewardsType &&
//               !t.flags.onGasTank
//             )
//           })
//           if (!protocolTokenInPortfolio) {
//             const positionAsset: SelectedAccountPortfolioTokenResult = {
//               amount: a.amount,
//               latestAmount: a.amount,
//               // Only list the borrowed asset with no price
//               priceIn: a.type === AssetType.Collateral ? [a.priceIn] : [],
//               decimals: Number(a.protocolAsset!.decimals),
//               address: a.protocolAsset!.address,
//               symbol: a.protocolAsset!.symbol,
//               name: a.protocolAsset!.name,
//               chainId: BigInt(chainId),
//               flags: {
//                 canTopUpGasTank: false,
//                 isFeeToken: false,
//                 onGasTank: false,
//                 rewardsType: null,
//                 defiTokenType: a.type
//                 // @BUG: defi positions tokens can't be hidden and can be added as custom
//                 // because processTokens is called in the portfolio
//                 // Issue: https://github.com/AmbireTech/ambire-app/issues/3971
//               }
//             }
//             const tokenBalanceUSD = positionAsset.priceIn[0]?.price
//               ? Number(
//                   safeTokenAmountAndNumberMultiplication(
//                     BigInt(positionAsset.amount),
//                     positionAsset.decimals,
//                     positionAsset.priceIn[0].price
//                   )
//                 )
//               : undefined

//             networkBalance += tokenBalanceUSD || 0
//             tokens.push(positionAsset)
//           } else if (
//             // If the asset isn't of type Borrow and has no price in USD
//             // we get the price from defi positions
//             a.type !== AssetType.Borrow &&
//             (!protocolTokenInPortfolio.priceIn.length ||
//               protocolTokenInPortfolio.priceIn[0]?.price === 0)
//           ) {
//             // Add a price.
//             // IMPORTANT: This must be done before calculating the token balance USD
//             protocolTokenInPortfolio.priceIn = [a.priceIn]
//             protocolTokenInPortfolio.flags.defiTokenType = a.type

//             const tokenBalanceUSD = protocolTokenInPortfolio.priceIn[0]?.price
//               ? Number(
//                   safeTokenAmountAndNumberMultiplication(
//                     BigInt(
//                       protocolTokenInPortfolio.amountPostSimulation ||
//                         protocolTokenInPortfolio.amount
//                     ),
//                     protocolTokenInPortfolio.decimals,
//                     protocolTokenInPortfolio.priceIn[0].price
//                   )
//                 )
//               : undefined

//             networkBalance += tokenBalanceUSD || 0
//           }
//         }

//         // search the asset in the portfolio tokens
//         const tokenInPortfolio = tokens.find((t) => {
//           const priceUSD = t.priceIn.find(
//             ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
//           )?.price

//           const tokenBalanceUSD = priceUSD
//             ? Number(
//                 safeTokenAmountAndNumberMultiplication(
//                   BigInt(t.amountPostSimulation || t.amount),
//                   t.decimals,
//                   priceUSD
//                 )
//               )
//             : undefined

//           if (a.protocolAsset?.symbol && a.protocolAsset.address) {
//             return (
//               t.chainId.toString() === chainId &&
//               !t.flags.rewardsType &&
//               !t.flags.onGasTank &&
//               t.address === getAddress(a.protocolAsset.address)
//             )
//           }

//           // If the token or asset don't have a value we MUST! not compare them
//           // by value as that would lead to false positives
//           if (!tokenBalanceUSD || !a.value) return false

//           // If there is no protocol asset we have to fallback to finding the token
//           // by symbol and chainId. In that case we must ensure that the value of the two
//           // assets is similar
//           return (
//             // chains should match
//             t.chainId.toString() === chainId &&
//             !t.flags.rewardsType &&
//             !t.flags.onGasTank &&
//             // the portfolio token should contain the original asset symbol
//             t.symbol.toLowerCase().includes(a.symbol.toLowerCase()) &&
//             // but should be a different token symbol
//             t.symbol.toLowerCase() !== a.symbol.toLowerCase() &&
//             // and prices should have no more than 0.5% diff
//             isTokenPriceWithinHalfPercent(tokenBalanceUSD || 0, a.value || 0)
//           )
//         })

//         if (!tokenInPortfolio || tokenInPortfolio?.flags.isHidden) return

//         // Note: There is an edge case where only one of the assets is handled
//         // by the portfolio, but we flip the flag, which means that we won't
//         // add the value of the position to the total balance. This will make the
//         // displayed balance (REAL BALANCE - the value of the missing asset).
//         if (a.type === AssetType.Collateral) shouldAddPositionUSDAmountToTheTotalBalance = false
//         // Remove the price of borrow tokens and ensure that the token is marked as Borrow
//         else if (a.type === AssetType.Borrow) {
//           tokenInPortfolio.priceIn = []
//           tokenInPortfolio.flags.defiTokenType = AssetType.Borrow
//         }
//       })

//       // We differ from wallets like Rabby in the way we add the value of
//       // positions to the total balance - we don't deduct the value of borrowed
//       // assets. Instead we use the collateral of positions or the position value in USD if
//       // the collateral is not available.
//       // Knowing that, it's confusing why we add the value of the position here. That is because
//       // we add the collateral value by adding the tokens to the portfolio and flipping this flag
//       // to false. If the portfolio doesn't have the token and we don't know the protocol asset
//       // there is no way to add the value of the collateral tokens to the total balance.
//       // In that case we add the value of the position to the total balance in order to not confuse the user.
//       if (shouldAddPositionUSDAmountToTheTotalBalance) {
//         networkBalance += pos.additionalData.positionInUSD || 0
//       }
//     })
//   })

//   return {
//     tokens,
//     defiPositionsBalance: networkBalance
//   }
// }

export const stripPortfolioState = (portfolioState: AccountState) => {
  const strippedState: SelectedAccountPortfolioState = {}

  Object.keys(portfolioState).forEach((chainId) => {
    const networkState = portfolioState[chainId]
    if (!networkState) return

    if (!networkState.result) {
      strippedState[chainId] = networkState
      return
    }

    // A trick to exclude specific keys
    const { tokens, collections, tokenErrors, toBeLearned, lastExternalApiUpdateData, ...result } =
      networkState.result

    strippedState[chainId] = { ...networkState, result }
  })

  return strippedState
}

export const isNetworkReady = (networkData: NetworkState | undefined) => {
  return networkData && (networkData.isReady || networkData?.criticalError)
}

/**
 * Calculates the selected account portfolio that is used by the UI
 */
export function calculateSelectedAccountPortfolio(
  portfolioState: AccountState,
  prevShouldShowPartialResult: boolean,
  isManualUpdate: boolean
): SelectedAccountPortfolio {
  const strippedPortfolioState = stripPortfolioState(portfolioState)

  const newPortfolio = Object.keys(portfolioState).reduce(
    (acc: Omit<SelectedAccountPortfolio, 'portfolioState'>, chainId) => {
      const networkData = portfolioState[chainId]

      // Don't do anything if the network data is not ready
      if (!portfolioState[chainId] || !networkData || !isNetworkReady(networkData)) {
        acc.isAllReady = false

        return acc
      }
      // Either the first update or a manual one
      const isLoadingFromScratch =
        (!isNetworkReady(networkData) || isManualUpdate) && networkData?.isLoading
      const networkResult = networkData.result
      const accountOp = networkData.accountOps?.[0]

      // Reloading means that the data is ready, but loading and not fresh
      // If the portfolio is loading while the data is fresh, we don't notify the user
      if (!acc.isReloading && networkData?.isLoading) {
        // We are only checking the portfolio data timestamp as defi positions are being
        // updated more rarely
        acc.isReloading =
          !!networkData?.result?.lastSuccessfulUpdate &&
          Date.now() - networkData.result.lastSuccessfulUpdate > 60 * 60 * 1000
      }

      if (isLoadingFromScratch) acc.isAllReady = false

      if (accountOp) {
        acc.networkSimulatedAccountOp[chainId] = accountOp
      }

      if (!networkResult) return acc

      return {
        ...acc,
        shouldShowPartialResult: false, // @TODO
        tokens: [...acc.tokens, ...networkResult.tokens],
        collections: [...acc.collections, ...networkResult.collections],
        totalBalance:
          acc.totalBalance + (chainId !== 'projectedRewards' ? networkResult.total?.usd || 0 : 0),
        balancePerNetwork: {
          ...acc.balancePerNetwork,
          [chainId]: networkResult.total?.usd || 0
        },
        isReadyToVisualize: acc.isReadyToVisualize // @TODO
      }
    },
    {
      tokens: [],
      collections: [],
      totalBalance: 0,
      isReadyToVisualize: true,
      isAllReady: true,
      isReloading: false,
      shouldShowPartialResult: prevShouldShowPartialResult,
      balancePerNetwork: {},
      networkSimulatedAccountOp: {}
    } as Omit<SelectedAccountPortfolio, 'portfolioState'>
  )

  return {
    portfolioState: strippedPortfolioState,
    ...newPortfolio
  }
}

export const calculateAndSetProjectedRewards = (
  projectedRewards: NetworkState<PortfolioProjectedRewardsResult> | undefined,
  latestBalances: { [chainId: string]: number },
  walletOrStkWalletTokenPrice: number | undefined
): ProjectedRewardsTokenResult | undefined => {
  if (!projectedRewards) return

  const result = projectedRewards?.result
  if (!result) return

  const {
    currentSeasonSnapshots,
    supportedChainIds,
    numberOfWeeksSinceStartOfSeason,
    totalRewardsPool,
    totalWeightNonUser,
    userLevel,
    walletPrice,
    minLvl,
    minBalance,
    userXp,
    reasonToNotDisplayProjectedRewards
  } = result
  if (reasonToNotDisplayProjectedRewards) return

  const currentTotalBalanceOnSupportedChains = supportedChainIds
    .map((chainId: number) => latestBalances[chainId] || 0)
    .reduce((a: number, b: number) => a + b, 0)

  const parsedSnapshotsBalance = currentSeasonSnapshots.map(
    (snapshot: { week: number; balance: number }) => snapshot.balance
  )

  // If the user never participated in Ambire Rewards, we assume they are at level 0.
  // If they have participated, but are below the minimum level, we assume they are at the minimum level because we need to calculate the APY.
  // For that purpose, we assume they are at the minimum level with minimum balance.
  // This means that their projected rewards will be 0, but we will be able to calculate the APY.
  const level = userLevel < minLvl ? minLvl : userLevel
  const currentBalance =
    currentTotalBalanceOnSupportedChains < minBalance
      ? minBalance
      : currentTotalBalanceOnSupportedChains

  // take the price of stkWALLET/WALLET if available from portfolio, otherwise WALLET from the relayer
  const walletTokenPrice = walletOrStkWalletTokenPrice || walletPrice

  const projectedAmount = calculateRewardsForSeason(
    level,
    parsedSnapshotsBalance,
    currentBalance,
    numberOfWeeksSinceStartOfSeason,
    totalWeightNonUser,
    totalRewardsPool,
    minLvl,
    minBalance
  )

  // If the user is below the minimum level or did not have a single week with balance >$500, they get 0 projected rewards
  const hasLowBalance = [...parsedSnapshotsBalance, currentTotalBalanceOnSupportedChains].every(
    (b) => b < minBalance
  )

  // Final projected amount after checks.
  // If the user is below min level or has low balance, it's 0.
  // If projected amount < 1, it's also 0.
  const shouldZeroRewards = userLevel < minLvl || hasLowBalance || projectedAmount < 1
  const finalProjectedAmount = shouldZeroRewards ? 0 : projectedAmount

  const projectedAmountFormatted = Math.round(finalProjectedAmount * 1e18)

  return {
    chainId: BigInt(1),
    amount: BigInt(projectedAmountFormatted || 0),
    address: WALLET_TOKEN,
    symbol: 'WALLET',
    name: '$WALLET',
    decimals: 18,
    priceIn: [{ baseCurrency: 'usd', price: walletTokenPrice }],
    userXp,
    flags: {
      onGasTank: false,
      rewardsType: 'wallet-projected-rewards' as const,
      canTopUpGasTank: false,
      isFeeToken: false
    }
  }
}
