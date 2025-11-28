import { getAddress } from 'ethers'

import { WALLET_TOKEN } from '../../consts/addresses'
import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioByNetworks,
  SelectedAccountPortfolioByNetworksNetworkState,
  SelectedAccountPortfolioState,
  SelectedAccountPortfolioTokenResult
} from '../../interfaces/selectedAccount'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import { calculateRewardsForSeason } from '../../utils/rewards'
import {
  AccountState as DefiPositionsAccountState,
  AssetType,
  NetworkState as DefiPositionsNetworkState,
  PositionsByProvider
} from '../defiPositions/types'
import {
  AccountState,
  CollectionResult,
  NetworkSimulatedAccountOp,
  NetworkState,
  PortfolioProjectedRewardsResult,
  ProjectedRewardsTokenResult,
  TokenResult
} from '../portfolio/interfaces'

const isTokenPriceWithinHalfPercent = (price1: number, price2: number): boolean => {
  const diff = Math.abs(price1 - price2)
  const threshold = 0.005 * Math.max(Math.abs(price1), Math.abs(price2))
  return diff <= threshold
}

export const isInternalChain = (chainId: string) => {
  return chainId === 'gasTank' || chainId === 'rewards' || chainId === 'projectedRewards'
}

/**
 * Adds the defi positions tokens that aren't handled by the portfolio.
 * Also calculates the total balance of the defi positions so it can be added to the total balance.
 */
export const calculateDefiPositions = (
  chainId: string,
  portfolioTokens: (TokenResult & {
    latestAmount?: bigint
    pendingAmount?: bigint
  })[],
  defiPositionsAccountState?: DefiPositionsAccountState
): {
  defiPositionsBalance: number
  tokens: (TokenResult & {
    latestAmount?: bigint
    pendingAmount?: bigint
  })[]
} | null => {
  const areDefiPositionsNotInitialized =
    !defiPositionsAccountState || Object.keys(defiPositionsAccountState).length === 0

  if (isInternalChain(chainId) || areDefiPositionsNotInitialized) {
    return null
  }

  const defiPositionsNetworkState = defiPositionsAccountState[chainId]

  const tokens = portfolioTokens
  let networkBalance = 0
  const positions = defiPositionsNetworkState || {}

  positions.positionsByProvider?.forEach((posByProv: PositionsByProvider) => {
    posByProv.positions.forEach((pos) => {
      if (pos.additionalData?.pool?.controller) {
        const tokenInPortfolio = tokens.find((t) => {
          return (
            t.address.toLowerCase() ===
              (pos.additionalData?.pool?.controller || '').toLowerCase() &&
            t.chainId.toString() === chainId &&
            !t.flags.rewardsType &&
            !t.flags.onGasTank
          )
        })

        // Skip if the controller token is already in the portfolio and has a price in USD
        // (custom tokens with no price can be added. In that case add the pos to the total balance)
        if (
          tokenInPortfolio &&
          tokenInPortfolio.amount !== 0n &&
          tokenInPortfolio.priceIn.find((p) => p.baseCurrency === 'usd' && p.price !== 0) &&
          !tokenInPortfolio.flags.isHidden
        )
          return
      }

      let shouldAddPositionUSDAmountToTheTotalBalance = true

      pos.assets.filter(Boolean).forEach((a) => {
        // if this "if" is ever removed, ensure that the defiTokenType flag is set correctly
        // for these asset types
        if (a.type === AssetType.Liquidity || a.type === AssetType.Reward) return

        if (a.protocolAsset && a.protocolAsset?.name) {
          const protocolTokenInPortfolio = tokens.find((t) => {
            return (
              t.address.toLowerCase() === (a.protocolAsset?.address || '').toLowerCase() &&
              t.chainId.toString() === chainId &&
              !t.flags.rewardsType &&
              !t.flags.onGasTank
            )
          })
          if (!protocolTokenInPortfolio) {
            const positionAsset: SelectedAccountPortfolioTokenResult = {
              amount: a.amount,
              latestAmount: a.amount,
              // Only list the borrowed asset with no price
              priceIn: a.type === AssetType.Collateral ? [a.priceIn] : [],
              decimals: Number(a.protocolAsset!.decimals),
              address: a.protocolAsset!.address,
              symbol: a.protocolAsset!.symbol,
              name: a.protocolAsset!.name,
              chainId: BigInt(chainId),
              flags: {
                canTopUpGasTank: false,
                isFeeToken: false,
                onGasTank: false,
                rewardsType: null,
                defiTokenType: a.type
                // @BUG: defi positions tokens can't be hidden and can be added as custom
                // because processTokens is called in the portfolio
                // Issue: https://github.com/AmbireTech/ambire-app/issues/3971
              }
            }
            const tokenBalanceUSD = positionAsset.priceIn[0]?.price
              ? Number(
                  safeTokenAmountAndNumberMultiplication(
                    BigInt(positionAsset.amount),
                    positionAsset.decimals,
                    positionAsset.priceIn[0].price
                  )
                )
              : undefined

            networkBalance += tokenBalanceUSD || 0
            tokens.push(positionAsset)
          } else if (
            // If the asset isn't of type Borrow and has no price in USD
            // we get the price from defi positions
            a.type !== AssetType.Borrow &&
            (!protocolTokenInPortfolio.priceIn.length ||
              protocolTokenInPortfolio.priceIn[0]?.price === 0)
          ) {
            // Add a price.
            // IMPORTANT: This must be done before calculating the token balance USD
            protocolTokenInPortfolio.priceIn = [a.priceIn]
            protocolTokenInPortfolio.flags.defiTokenType = a.type

            const tokenBalanceUSD = protocolTokenInPortfolio.priceIn[0]?.price
              ? Number(
                  safeTokenAmountAndNumberMultiplication(
                    BigInt(
                      protocolTokenInPortfolio.amountPostSimulation ||
                        protocolTokenInPortfolio.amount
                    ),
                    protocolTokenInPortfolio.decimals,
                    protocolTokenInPortfolio.priceIn[0].price
                  )
                )
              : undefined

            networkBalance += tokenBalanceUSD || 0
          }
        }

        // search the asset in the portfolio tokens
        const tokenInPortfolio = tokens.find((t) => {
          const priceUSD = t.priceIn.find(
            ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
          )?.price

          const tokenBalanceUSD = priceUSD
            ? Number(
                safeTokenAmountAndNumberMultiplication(
                  BigInt(t.amountPostSimulation || t.amount),
                  t.decimals,
                  priceUSD
                )
              )
            : undefined

          if (a.protocolAsset?.symbol && a.protocolAsset.address) {
            return (
              t.chainId.toString() === chainId &&
              !t.flags.rewardsType &&
              !t.flags.onGasTank &&
              t.address === getAddress(a.protocolAsset.address)
            )
          }

          // If the token or asset don't have a value we MUST! not compare them
          // by value as that would lead to false positives
          if (!tokenBalanceUSD || !a.value) return false

          // If there is no protocol asset we have to fallback to finding the token
          // by symbol and chainId. In that case we must ensure that the value of the two
          // assets is similar
          return (
            // chains should match
            t.chainId.toString() === chainId &&
            !t.flags.rewardsType &&
            !t.flags.onGasTank &&
            // the portfolio token should contain the original asset symbol
            t.symbol.toLowerCase().includes(a.symbol.toLowerCase()) &&
            // but should be a different token symbol
            t.symbol.toLowerCase() !== a.symbol.toLowerCase() &&
            // and prices should have no more than 0.5% diff
            isTokenPriceWithinHalfPercent(tokenBalanceUSD || 0, a.value || 0)
          )
        })

        if (!tokenInPortfolio || tokenInPortfolio?.flags.isHidden) return

        // Note: There is an edge case where only one of the assets is handled
        // by the portfolio, but we flip the flag, which means that we won't
        // add the value of the position to the total balance. This will make the
        // displayed balance (REAL BALANCE - the value of the missing asset).
        if (a.type === AssetType.Collateral) shouldAddPositionUSDAmountToTheTotalBalance = false
        // Remove the price of borrow tokens and ensure that the token is marked as Borrow
        else if (a.type === AssetType.Borrow) {
          tokenInPortfolio.priceIn = []
          tokenInPortfolio.flags.defiTokenType = AssetType.Borrow
        }
      })

      // We differ from wallets like Rabby in the way we add the value of
      // positions to the total balance - we don't deduct the value of borrowed
      // assets. Instead we use the collateral of positions or the position value in USD if
      // the collateral is not available.
      // Knowing that, it's confusing why we add the value of the position here. That is because
      // we add the collateral value by adding the tokens to the portfolio and flipping this flag
      // to false. If the portfolio doesn't have the token and we don't know the protocol asset
      // there is no way to add the value of the collateral tokens to the total balance.
      // In that case we add the value of the position to the total balance in order to not confuse the user.
      if (shouldAddPositionUSDAmountToTheTotalBalance) {
        networkBalance += pos.additionalData.positionInUSD || 0
      }
    })
  })

  return {
    tokens,
    defiPositionsBalance: networkBalance
  }
}

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
    const {
      tokens,
      collections,
      tokenErrors,
      priceCache,
      toBeLearned,
      lastExternalApiUpdateData,
      ...result
    } = networkState.result

    strippedState[chainId] = { ...networkState, result }
  })

  return strippedState
}

export const isNetworkReady = (networkData: NetworkState | undefined) => {
  return networkData && (networkData.isReady || networkData?.criticalError)
}

export const isDefiNetworkStateReady = (
  chainId: string,
  defiNetworkData: DefiPositionsNetworkState | undefined
) => {
  // Internal chains are always ready. Also, in case the defi network data is missing we
  // don't want to block the portfolio calculation.
  if (isInternalChain(chainId) || !defiNetworkData) return true

  return defiNetworkData.updatedAt || defiNetworkData?.error
}

/**
 * calculateSelectedAccountPortfolio is called after every portfolio update and we don't want to recalculate
 * the same network data if it hasn't changed.
 */
export const getIsRecalculationNeeded = (
  pastAccountPortfolioWithDefiPositionsNetworkState: SelectedAccountPortfolioByNetworksNetworkState,
  portfolioState: NetworkState,
  defiPositionsNetworkState: DefiPositionsNetworkState | undefined
): boolean => {
  if (!pastAccountPortfolioWithDefiPositionsNetworkState) {
    return true
  }

  // Never recalculate if either the portfolio or defi positions are loading
  // as that would reset isAllReady to false
  if (portfolioState?.isLoading || defiPositionsNetworkState?.isLoading) {
    return false
  }

  const pastAccountOp = pastAccountPortfolioWithDefiPositionsNetworkState.simulatedAccountOp
  const networkDataAccountOp = portfolioState?.accountOps?.[0]

  // If there is or was an account op we must recalculate the portfolio
  // on every update to ensure that the simulations are correct
  if (pastAccountOp || networkDataAccountOp) return true

  const hasPortfolioUpdated =
    pastAccountPortfolioWithDefiPositionsNetworkState.portfolioUpdateStarted !==
    portfolioState.result?.updateStarted

  const areDefiPositionsUpdated =
    pastAccountPortfolioWithDefiPositionsNetworkState.defiPositionsUpdatedAt !==
    defiPositionsNetworkState?.updatedAt

  return hasPortfolioUpdated || areDefiPositionsUpdated
}

/**
 * Calculates the portfolio tokens, total balance, collections and defi positions for a specific network.
 * In essence, it merges all states (portfolio, defi positions) into a single network portfolio state.
 */
const recalculateNetworkPortfolio = (
  network: string,
  portfolioState: NetworkState,
  defiPositionsAccountState: DefiPositionsAccountState,
  simulatedAccountOp: NetworkSimulatedAccountOp[string] | undefined
) => {
  const collectionsArray: CollectionResult[] = portfolioState.result?.collections || []
  let tokensArray = portfolioState.result?.tokens || []
  let networkTotal = portfolioState.result?.total?.usd || 0
  const hasTokensWithAmountOnNetwork = tokensArray.some(({ amount }) => amount > 0n)

  // In case defi positions haven't loaded at this point we will still calculate the portfolio
  // and add the defi positions when they are ready. This is done to not block the user from seeing
  // their portfolio because of a loading issue with defi positions
  const defiPositions = calculateDefiPositions(network, tokensArray, defiPositionsAccountState)

  // Replace the token list with the token list that has the defi tokens
  if (defiPositions?.tokens.length) {
    tokensArray = defiPositions.tokens
  }

  // Add the defi positions balance to the total balance
  networkTotal += defiPositions?.defiPositionsBalance || 0

  // Update the cached network state when the network is completely loaded
  return {
    hasTokensWithAmount: hasTokensWithAmountOnNetwork,
    state: {
      totalBalance: networkTotal,
      tokens: tokensArray,
      collections: collectionsArray,
      portfolioUpdateStarted: portfolioState.result?.updateStarted,
      defiPositionsUpdatedAt: defiPositionsAccountState[network]?.updatedAt,
      simulatedAccountOp
    }
  }
}

/**
 * Calculates the selected account portfolio (divided by networks).
 * It checks the status of the networks - whether they are ready or not, loading etc.
 * It also updates the portfolio with defi positions.
 * It's optimized to avoid unnecessary recalculations by comparing the new portfolio/defi positions state
 * with the previous one. (by nonce, block number, simulation status, defi positions updated at timestamp)
 */
export function calculateSelectedAccountPortfolioByNetworks(
  portfolioState: AccountState,
  pastAccountPortfolioWithDefiPositions: SelectedAccountPortfolioByNetworks,
  defiPositionsAccountState: DefiPositionsAccountState,
  shouldShowPartialResult: boolean,
  isManualUpdate: boolean
): {
  selectedAccountPortfolioByNetworks: SelectedAccountPortfolioByNetworks
  isAllReady: boolean
  isReadyToVisualize: boolean
  isReloading: boolean
  shouldShowPartialResult: boolean
} {
  const newAccountPortfolioWithDefiPositions: SelectedAccountPortfolioByNetworks =
    pastAccountPortfolioWithDefiPositions
  const hasState = Object.keys(portfolioState).length > 0

  if (!hasState) {
    return {
      selectedAccountPortfolioByNetworks: {},
      isAllReady: false,
      isReloading: false,
      shouldShowPartialResult: false,
      isReadyToVisualize: false
    }
  }

  let isAllReady = !!hasState
  let isReadyToVisualize = false
  let hasTokensWithAmount = false
  let isReloading = false

  // Use the merged portfolio state for the calculation
  // Merges the portfolio with the defi positions
  Object.keys(portfolioState).forEach((network: string) => {
    const networkData = portfolioState[network]
    const defiPositionsNetworkState = defiPositionsAccountState[network]
    const isDefiOrPortfolioNotReady =
      !isNetworkReady(networkData) || !isDefiNetworkStateReady(network, defiPositionsNetworkState)

    // --- READY / LOADING LOGIC ---

    // Don't do anything if the network data is not ready
    if (!portfolioState[network] || !networkData || isDefiOrPortfolioNotReady) {
      delete newAccountPortfolioWithDefiPositions[network]
      isAllReady = false

      return
    }

    const isDefiOrPortfolioLoading = networkData?.isLoading || defiPositionsNetworkState?.isLoading
    // Either the first update or a manual one
    const isLoadingFromScratch =
      (isDefiOrPortfolioNotReady || isManualUpdate) && isDefiOrPortfolioLoading

    // Reloading means that the data is ready, but loading and not fresh
    // If the portfolio is loading while the data is fresh, we don't notify the user
    if (!isReloading && isDefiOrPortfolioLoading) {
      // We are only checking the portfolio data timestamp as defi positions are being
      // updated more rarely
      isReloading =
        !!networkData?.result?.lastSuccessfulUpdate &&
        Date.now() - networkData.result.lastSuccessfulUpdate > 60 * 60 * 1000
    }

    if (isLoadingFromScratch) isAllReady = false

    // --- CACHE OR RECALCULATE LOGIC ---

    const pastAccountPortfolioWithDefiPositionsNetworkState =
      pastAccountPortfolioWithDefiPositions[network]
    // Check if a recalculation is needed or the past state can be reused
    const shouldRecalculateState = getIsRecalculationNeeded(
      pastAccountPortfolioWithDefiPositionsNetworkState,
      networkData,
      defiPositionsNetworkState
    )

    if (!shouldRecalculateState) {
      // If a recalculation is not needed, we just copy the previous state
      newAccountPortfolioWithDefiPositions[network] =
        pastAccountPortfolioWithDefiPositionsNetworkState

      if (!hasTokensWithAmount) {
        hasTokensWithAmount = pastAccountPortfolioWithDefiPositionsNetworkState.tokens.some(
          ({ amount }) => amount > 0n
        )
      }

      return
    }

    // Recalculate the state
    const { state, hasTokensWithAmount: hasTokensWithAmountOnNetwork } =
      recalculateNetworkPortfolio(
        network,
        networkData,
        defiPositionsAccountState,
        networkData.accountOps?.[0]
      )

    newAccountPortfolioWithDefiPositions[network] = state

    if (hasTokensWithAmountOnNetwork) {
      hasTokensWithAmount = true
    }
  })

  if ((shouldShowPartialResult && hasTokensWithAmount && !isAllReady) || isAllReady) {
    // Allow the user to operate with the tokens that have loaded
    isReadyToVisualize = true
  }

  return {
    // If all data is ready, we don't show partial results
    shouldShowPartialResult: isAllReady ? false : shouldShowPartialResult,
    isReadyToVisualize,
    isAllReady,
    // Can be reloading only if all data is ready
    isReloading: isAllReady ? isReloading : false,
    selectedAccountPortfolioByNetworks: newAccountPortfolioWithDefiPositions
  }
}

/**
 * Calculates the selected account portfolio that is used by the UI and a
 * selected account portfolio divided by networks.
 * For more info see calculateSelectedAccountPortfolioByNetworks.
 */
export function calculateSelectedAccountPortfolio(
  portfolioAccountState: AccountState,
  pastAccountPortfolioWithDefiPositions: SelectedAccountPortfolioByNetworks,
  defiPositionsAccountState: DefiPositionsAccountState,
  prevShouldShowPartialResult: boolean,
  isManualUpdate: boolean
): {
  selectedAccountPortfolio: SelectedAccountPortfolio
  selectedAccountPortfolioByNetworks: SelectedAccountPortfolioByNetworks
} {
  const {
    selectedAccountPortfolioByNetworks,
    isAllReady,
    isReadyToVisualize,
    isReloading,
    shouldShowPartialResult
  } = calculateSelectedAccountPortfolioByNetworks(
    portfolioAccountState,
    pastAccountPortfolioWithDefiPositions,
    defiPositionsAccountState,
    prevShouldShowPartialResult,
    isManualUpdate
  )

  const selectedAccountPortfolio: SelectedAccountPortfolio = {
    tokens: [],
    collections: [],
    totalBalance: 0,
    isReloading,
    balancePerNetwork: {},
    isReadyToVisualize,
    isAllReady,
    shouldShowPartialResult,
    networkSimulatedAccountOp: {},
    portfolioState: stripPortfolioState(portfolioAccountState)
  }

  Object.keys(selectedAccountPortfolioByNetworks).forEach((chainId) => {
    const networkData = selectedAccountPortfolioByNetworks[chainId]
    const isProjectedRewardsChain = chainId === 'projectedRewards'

    if (!networkData) return

    if (networkData.simulatedAccountOp) {
      selectedAccountPortfolio.networkSimulatedAccountOp[chainId] = networkData.simulatedAccountOp
    }
    selectedAccountPortfolio.tokens.push(...networkData.tokens)
    selectedAccountPortfolio.collections.push(...networkData.collections)
    selectedAccountPortfolio.totalBalance += !isProjectedRewardsChain
      ? networkData.totalBalance || 0
      : 0
    selectedAccountPortfolio.balancePerNetwork[chainId] = networkData.totalBalance || 0
  })

  return {
    selectedAccountPortfolio,
    selectedAccountPortfolioByNetworks
  }
}

export const calculateAndSetProjectedRewards = (
  projectedRewards: NetworkState | undefined,
  latestBalances: { [chainId: string]: number },
  walletOrStkWalletTokenPrice: number | undefined
): ProjectedRewardsTokenResult | undefined => {
  if (!projectedRewards) return

  const result = projectedRewards?.result as PortfolioProjectedRewardsResult
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
    userXp
  } = result

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
