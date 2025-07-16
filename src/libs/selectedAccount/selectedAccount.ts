import { getAddress } from 'ethers'

import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioByNetworks,
  SelectedAccountPortfolioByNetworksNetworkState,
  SelectedAccountPortfolioState,
  SelectedAccountPortfolioTokenResult
} from '../../interfaces/selectedAccount'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import { isAccountOpsIntentEqual } from '../accountOp/accountOp'
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
  TokenResult
} from '../portfolio/interfaces'

const isTokenPriceWithinHalfPercent = (price1: number, price2: number): boolean => {
  const diff = Math.abs(price1 - price2)
  const threshold = 0.005 * Math.max(Math.abs(price1), Math.abs(price2))
  return diff <= threshold
}

/**
 * Adds defi positions to the portfolio network state.
 * It updates the total balance and adds tokens that aren't handled by the portfolio.
 * It also modifies defi tokens that are handled by the portfolio
 */
export const updatePortfolioNetworkWithDefiPositions = (
  chainId: string,
  networkState?: NetworkState,
  defiPositionsNetworkState?: DefiPositionsNetworkState
) => {
  if (chainId === 'gasTank' || chainId === 'rewards') {
    return networkState
  }

  if (!networkState || !defiPositionsNetworkState) return null

  // If there is an error we can simply return the original network state
  if (!networkState.result) {
    return networkState
  }

  const tokens = networkState.result.tokens || []
  let networkBalance = networkState.result.total?.usd || 0
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
          tokenInPortfolio.priceIn.find((p) => p.baseCurrency === 'usd' && p.price !== 0)
        )
          return
      }

      let shouldAddPositionUSDAmountToTheTotalBalance = true

      pos.assets.filter(Boolean).forEach((a) => {
        if (a.protocolAsset) {
          if (a.protocolAsset?.name) {
            const protocolTokenInPortfolio = tokens.find((t) => {
              return (
                t.address.toLowerCase() === (a.protocolAsset?.address || '').toLowerCase() &&
                t.chainId.toString() === chainId &&
                !t.flags.rewardsType &&
                !t.flags.onGasTank
              )
            })
            if (!protocolTokenInPortfolio) {
              const positionAsset: TokenResult = {
                amount: a.amount,
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
            } else if (protocolTokenInPortfolio.flags.defiTokenType !== AssetType.Borrow) {
              if (
                !protocolTokenInPortfolio.priceIn.length ||
                protocolTokenInPortfolio.priceIn[0]?.price === 0
              ) {
                protocolTokenInPortfolio.priceIn =
                  a.type === AssetType.Collateral ? [a.priceIn] : []

                protocolTokenInPortfolio.flags.defiTokenType = a.type

                if (a.type !== AssetType.Borrow) {
                  const tokenBalanceUSD = protocolTokenInPortfolio.priceIn[0]?.price
                    ? Number(
                        safeTokenAmountAndNumberMultiplication(
                          BigInt(protocolTokenInPortfolio.amount),
                          protocolTokenInPortfolio.decimals,
                          protocolTokenInPortfolio.priceIn[0].price
                        )
                      )
                    : undefined
                  networkBalance += tokenBalanceUSD || 0
                }
              }
            }
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
              t.address === getAddress(a.address)
            )
          }

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
            (!a.value || isTokenPriceWithinHalfPercent(tokenBalanceUSD || 0, a.value))
          )
        })

        if (tokenInPortfolio?.flags.isHidden) return

        if (tokenInPortfolio) {
          shouldAddPositionUSDAmountToTheTotalBalance = false
          // Get the price from defiPositions
          tokenInPortfolio.priceIn = a.type === AssetType.Borrow ? [] : tokenInPortfolio.priceIn
        }
      })

      if (shouldAddPositionUSDAmountToTheTotalBalance) {
        networkBalance += pos.additionalData.positionInUSD || 0
      }
    })
  })

  // eslint-disable-next-line no-param-reassign
  networkState!.result!.total.usd = networkBalance
  // eslint-disable-next-line no-param-reassign
  networkState!.result!.tokens = tokens

  return networkState
}

const stripPortfolioState = (portfolioState: AccountState) => {
  const strippedState: SelectedAccountPortfolioState = {}

  Object.keys(portfolioState).forEach((chainId) => {
    const networkState = portfolioState[chainId]
    if (!networkState) return

    if (!networkState.result) {
      strippedState[chainId] = networkState
      return
    }

    // A trick to exclude specific keys
    const { tokens, collections, tokenErrors, priceCache, hintsFromExternalAPI, ...result } =
      networkState.result

    strippedState[chainId] = { ...networkState, result }
  })

  return strippedState
}

export const isNetworkReady = (networkData: NetworkState | undefined) => {
  return networkData && (networkData.isReady || networkData?.criticalError)
}

const calculateTokenArray = (
  chainId: string,
  latestTokens: TokenResult[],
  pendingTokens: TokenResult[],
  isPendingValid: boolean
) => {
  if (chainId === 'gasTank' || chainId === 'rewards') {
    return latestTokens
  }
  // If the pending state is older or there are no pending tokens
  // we shouldn't trust it to build the tokens array
  if (isPendingValid && pendingTokens.length) {
    return pendingTokens.map((pendingToken) => {
      let latestAmount: bigint | undefined

      const latestToken = latestTokens.find((latest) => {
        return latest.address === pendingToken.address
      })

      if (latestToken) {
        latestAmount = latestToken.amount
      } else if (pendingToken.flags.defiTokenType) {
        // Defi positions tokens that aren't handled by the portfolio are added to only
        // one of the portfolio states. In this case the token is only added to the pending state
        // and has no latest amount, thus both amounts are the same
        latestAmount = pendingToken.amount
      }

      return {
        ...pendingToken,
        latestAmount,
        pendingAmount: pendingToken.amount
      }
    })
  }

  // Add only latestAmount to the tokens
  return latestTokens.map((token) => {
    return {
      ...token,
      latestAmount: token.amount
    }
  })
}

/**
 * calculateSelectedAccountPortfolio is called after every portfolio update and we don't want to recalculate
 * the same network data if it hasn't changed.
 */
const getIsRecalculationNeeded = (
  pastAccountPortfolioWithDefiPositionsNetworkState: SelectedAccountPortfolioByNetworksNetworkState,
  networkData: NetworkState | undefined,
  defiPositionsNetworkState: DefiPositionsNetworkState | undefined
) => {
  if (
    !networkData ||
    !pastAccountPortfolioWithDefiPositionsNetworkState ||
    !defiPositionsNetworkState
  ) {
    return true
  }

  // Never recalculate if either the portfolio or defi positions are loading
  // as that would reset isAllReady to false
  if (networkData?.isLoading || defiPositionsNetworkState.isLoading) return false

  const hasPortfolioUpdated =
    pastAccountPortfolioWithDefiPositionsNetworkState.blockNumber !==
    networkData.result?.blockNumber

  if (hasPortfolioUpdated) return true

  const areDefiPositionsUpdated =
    pastAccountPortfolioWithDefiPositionsNetworkState.defiPositionsUpdatedAt !==
    defiPositionsNetworkState?.updatedAt

  if (areDefiPositionsUpdated) return true

  // Whether the simulation has changed
  const pastAccountOp = pastAccountPortfolioWithDefiPositionsNetworkState.simulatedAccountOp
  const networkDataAccountOp = networkData?.accountOps?.[0]

  if (pastAccountOp && networkDataAccountOp) {
    return isAccountOpsIntentEqual([pastAccountOp], [networkDataAccountOp])
  }

  return pastAccountOp !== networkDataAccountOp
}

/**
 * Calculates the selected account portfolio (divided by networks).
 * It combines the latest and pending states, checks the status of the networks-
 * whether they are ready or not, loading etc.
 * It also updates the portfolio with defi positions.
 * It's optimized to avoid unnecessary recalculations by comparing the new portfolio/defi positions state
 * with the previous one. (by nonce, block number, simulation status, defi positions updated at timestamp)
 */
export function calculateSelectedAccountPortfolioByNetworks(
  latestStateSelectedAccount: AccountState,
  pendingStateSelectedAccount: AccountState,
  pastAccountPortfolioWithDefiPositions: SelectedAccountPortfolioByNetworks,
  portfolioStartedLoadingAtTimestamp: number | null,
  defiPositionsAccountState: DefiPositionsAccountState,
  hasSignAccountOp: boolean,
  isLoadingFromScratch: boolean
): {
  selectedAccountPortfolioByNetworks: SelectedAccountPortfolioByNetworks
  isAllReady: boolean
  isReadyToVisualize: boolean
} {
  const now = Date.now()
  const shouldShowPartialResult =
    portfolioStartedLoadingAtTimestamp && now - portfolioStartedLoadingAtTimestamp > 5000
  const newAccountPortfolioWithDefiPositions: SelectedAccountPortfolioByNetworks = {}

  const hasLatest = latestStateSelectedAccount && Object.keys(latestStateSelectedAccount).length
  let isAllReady = !!hasLatest
  let isReadyToVisualize = false
  const tokens: SelectedAccountPortfolioTokenResult[] = []

  const hasPending = pendingStateSelectedAccount && Object.keys(pendingStateSelectedAccount).length

  if (!hasLatest && !hasPending) {
    return {
      selectedAccountPortfolioByNetworks: {},
      isAllReady: false,
      isReadyToVisualize: false
    }
  }

  let selectedAccountData = latestStateSelectedAccount

  /**
   * Replaces the latest state if the following conditions are true:
   * - There is no critical error in the pending state.
   * - The pending block number is newer than the latest OR we have a signed acc op (because of simulation).
   */
  const validSelectedAccountPendingState: AccountState = {}
  const simulatedAccountOps: NetworkSimulatedAccountOp = {}

  Object.keys(pendingStateSelectedAccount).forEach((network) => {
    const pendingNetworkData = pendingStateSelectedAccount[network]
    const latestNetworkData = latestStateSelectedAccount[network]

    // Compare the block numbers to determine if the pending state is newer
    if (latestNetworkData?.result?.blockNumber && pendingNetworkData?.result?.blockNumber) {
      const isPendingNewer =
        pendingNetworkData.result.blockNumber! >= latestNetworkData.result.blockNumber!

      if (!pendingNetworkData.criticalError && (isPendingNewer || hasSignAccountOp)) {
        validSelectedAccountPendingState[network] = pendingNetworkData
      }
    }

    // Store the simulated account op
    const accountOp = pendingNetworkData?.accountOps?.[0]

    if (accountOp) {
      simulatedAccountOps[network] = accountOp
    }
  })

  if (hasPending && Object.keys(validSelectedAccountPendingState).length > 0) {
    selectedAccountData = {
      ...selectedAccountData,
      ...validSelectedAccountPendingState
    }
  }

  Object.keys(selectedAccountData).forEach((network: string) => {
    const networkData = selectedAccountData[network]

    const defiPositionsNetworkState = defiPositionsAccountState[network]
    const pastAccountPortfolioWithDefiPositionsNetworkState =
      pastAccountPortfolioWithDefiPositions[network]

    const shouldRecalculateState = getIsRecalculationNeeded(
      pastAccountPortfolioWithDefiPositionsNetworkState,
      networkData,
      defiPositionsNetworkState
    )

    if (!shouldRecalculateState) {
      tokens.push(...(pastAccountPortfolioWithDefiPositionsNetworkState?.tokens || []))

      newAccountPortfolioWithDefiPositions[network] =
        pastAccountPortfolioWithDefiPositionsNetworkState

      return
    }

    const networkDataWithDefiPositions = updatePortfolioNetworkWithDefiPositions(
      network,
      networkData,
      defiPositionsNetworkState
    )
    const result = networkDataWithDefiPositions?.result
    let tokensArray: SelectedAccountPortfolioTokenResult[] = []
    let collectionsArray: CollectionResult[] = []
    let networkTotal = 0

    if (networkDataWithDefiPositions && result && isNetworkReady(networkDataWithDefiPositions)) {
      networkTotal = Number(result?.total?.usd) || 0

      const latestTokens = latestStateSelectedAccount[network]?.result?.tokens || []
      const pendingTokens = pendingStateSelectedAccount[network]?.result?.tokens || []
      collectionsArray = result?.collections || []

      tokensArray = calculateTokenArray(
        network,
        latestTokens,
        pendingTokens,
        !!validSelectedAccountPendingState[network]
      )
      tokens.push(...tokensArray)
    }

    if (
      !networkDataWithDefiPositions ||
      // The network is not ready
      !isNetworkReady(networkDataWithDefiPositions) ||
      // The networks is ready but the previous state isn't satisfactory and the network is still loading
      (isLoadingFromScratch &&
        (networkDataWithDefiPositions?.isLoading ||
          // The total balance and token list are affected by the defi positions
          defiPositionsAccountState[network]?.isLoading))
    ) {
      isAllReady = false
    } else {
      // Update the cached network state when the network is completely loaded
      newAccountPortfolioWithDefiPositions[network] = {
        totalBalance: networkTotal,
        tokens: tokensArray,
        collections: collectionsArray,
        blockNumber: result?.blockNumber,
        defiPositionsUpdatedAt: defiPositionsAccountState[network]?.updatedAt,
        simulatedAccountOp: simulatedAccountOps[network]
      }
    }
  })

  const tokensWithAmount = tokens.filter((token) => token.amount)

  if ((shouldShowPartialResult && tokensWithAmount.length && !isAllReady) || isAllReady) {
    // Allow the user to operate with the tokens that have loaded
    isReadyToVisualize = true
  }

  return {
    isReadyToVisualize,
    isAllReady,
    selectedAccountPortfolioByNetworks: newAccountPortfolioWithDefiPositions
  }
}

/**
 * Calculates the selected account portfolio that is used by the UI and a
 * selected account portfolio divided by networks.
 * For more info see calculateSelectedAccountPortfolioByNetworks.
 */
export function calculateSelectedAccountPortfolio(
  latestStateSelectedAccount: AccountState,
  pendingStateSelectedAccount: AccountState,
  pastAccountPortfolioWithDefiPositions: SelectedAccountPortfolioByNetworks,
  portfolioStartedLoadingAtTimestamp: number | null,
  defiPositionsAccountState: DefiPositionsAccountState,
  hasSignAccountOp: boolean,
  isLoadingFromScratch: boolean
): {
  selectedAccountPortfolio: SelectedAccountPortfolio
  selectedAccountPortfolioByNetworks: SelectedAccountPortfolioByNetworks
} {
  const { selectedAccountPortfolioByNetworks, isAllReady, isReadyToVisualize } =
    calculateSelectedAccountPortfolioByNetworks(
      latestStateSelectedAccount,
      pendingStateSelectedAccount,
      pastAccountPortfolioWithDefiPositions,
      portfolioStartedLoadingAtTimestamp,
      defiPositionsAccountState,
      hasSignAccountOp,
      isLoadingFromScratch
    )

  const selectedAccountPortfolio: SelectedAccountPortfolio = {
    tokens: [],
    collections: [],
    totalBalance: 0,
    isReadyToVisualize,
    isAllReady,
    networkSimulatedAccountOp: {},
    latest: stripPortfolioState(latestStateSelectedAccount),
    pending: stripPortfolioState(pendingStateSelectedAccount)
  }

  Object.keys(selectedAccountPortfolioByNetworks).forEach((chainId) => {
    const networkData = selectedAccountPortfolioByNetworks[chainId]
    if (!networkData) return

    if (selectedAccountPortfolio.networkSimulatedAccountOp[chainId]) {
      selectedAccountPortfolio.networkSimulatedAccountOp[chainId] = networkData.simulatedAccountOp
    }
    selectedAccountPortfolio.tokens.push(...networkData.tokens)
    selectedAccountPortfolio.collections.push(...networkData.collections)
    selectedAccountPortfolio.totalBalance += networkData.totalBalance || 0
  })

  return {
    selectedAccountPortfolio,
    selectedAccountPortfolioByNetworks
  }
}
