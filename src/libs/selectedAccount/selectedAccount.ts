import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState
} from '../../interfaces/selectedAccount'
import { AccountState, NetworkState } from '../portfolio/interfaces'

export const isInternalChain = (chainId: string) => {
  return chainId === 'gasTank' || chainId === 'rewards' || chainId === 'projectedRewards'
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
    const { tokens, collections, tokenErrors, toBeLearned, lastExternalApiUpdateData, ...result } =
      networkState.result

    strippedState[chainId] = { ...networkState, result }
  })

  return strippedState
}

export const isNetworkReady = (networkData: NetworkState | undefined) => {
  return networkData && (networkData.isReady || networkData?.criticalError)
}

export const DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = {
  tokens: [],
  collections: [],
  defiPositions: [],
  tokenAmounts: [],
  totalBalance: 0,
  balancePerNetwork: {},
  isReadyToVisualize: false,
  isAllReady: false,
  shouldShowPartialResult: false,
  isReloading: false,
  networkSimulatedAccountOp: {},
  portfolioState: {},
  projectedRewardsStats: null
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

  if (Object.keys(portfolioState).length === 0) {
    return DEFAULT_SELECTED_ACCOUNT_PORTFOLIO
  }

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
      acc.tokens = [...acc.tokens, ...(networkResult?.tokens || [])]

      if (
        (!acc.isReadyToVisualize &&
          acc.tokens.some((t) => t.amount > 0n && !t.flags.isHidden) &&
          !acc.isAllReady) ||
        acc.isAllReady
      ) {
        acc.isReadyToVisualize = true
      }

      return {
        ...acc,
        shouldShowPartialResult: acc.isAllReady ? false : prevShouldShowPartialResult,
        defiPositions: [
          ...acc.defiPositions,
          ...(networkResult?.defiPositions?.positionsByProvider || [])
        ],
        collections: [...acc.collections, ...(networkResult?.collections || [])],
        totalBalance:
          acc.totalBalance + (chainId !== 'projectedRewards' ? networkResult.total?.usd || 0 : 0),
        balancePerNetwork: {
          ...acc.balancePerNetwork,
          [chainId]: networkResult.total?.usd || 0
        }
      }
    },
    {
      ...structuredClone(DEFAULT_SELECTED_ACCOUNT_PORTFOLIO),
      isAllReady: true,
      isReadyToVisualize: true,
      shouldShowPartialResult: prevShouldShowPartialResult
    }
  )

  return {
    ...newPortfolio,
    portfolioState: strippedPortfolioState,
    defiPositions: newPortfolio.defiPositions.sort((a, b) => {
      if (b.providerName === 'Ambire' && a.providerName !== 'Ambire') return 1
      if (a.providerName === 'Ambire' && b.providerName !== 'Ambire') return -1

      return (b.positionInUSD || 0) - (a.positionInUSD || 0)
    })
  }
}
