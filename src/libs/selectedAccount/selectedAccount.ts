import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState
} from '../../interfaces/selectedAccount'
import { AccountState, NetworkState } from '../portfolio/interfaces'
import PortfolioViewBuilder from './portfolioView'

export const isInternalChain = (chainId: string) => {
  return chainId === 'gasTank' || chainId === 'rewards' || chainId === 'projectedRewards'
}

export const stripPortfolioState = (portfolioState: AccountState) => {
  const strippedState: SelectedAccountPortfolioState = {}

  Object.keys(portfolioState).forEach((chainId) => {
    const networkState = portfolioState[chainId]
    if (!networkState) return

    if (!networkState.result) {
      strippedState[chainId] = {
        ...networkState,
        result: undefined
      }
      return
    }

    // A trick to exclude specific keys
    const {
      tokens,
      collections,
      tokenErrors,
      toBeLearned,
      lastExternalApiUpdateData,
      priceCache,
      defiPositions,
      ...result
    } = networkState.result

    strippedState[chainId] = {
      ...networkState,
      result: {
        ...result,
        // Defi position state should be readable to allow for error handling
        // and manual debugging. Positions are excluded to reduce size.
        defiPositions: defiPositions
          ? {
              providerErrors: defiPositions.providerErrors,
              error: defiPositions.error,
              lastSuccessfulUpdate: defiPositions.lastSuccessfulUpdate
            }
          : undefined
      }
    }
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
  shouldShowPartialResult: boolean,
  isManualUpdate: boolean
): SelectedAccountPortfolio {
  const strippedPortfolioState = stripPortfolioState(portfolioState)

  if (Object.keys(portfolioState).length === 0) {
    return DEFAULT_SELECTED_ACCOUNT_PORTFOLIO
  }

  const portfolioViewBuilder = new PortfolioViewBuilder()

  Object.entries(portfolioState).forEach(([chainId, networkData]) => {
    portfolioViewBuilder.addNetworkData(chainId, networkData, isManualUpdate)
  })

  return portfolioViewBuilder.build(shouldShowPartialResult, strippedPortfolioState)
}
