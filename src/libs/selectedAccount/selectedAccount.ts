import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState
} from '../../interfaces/selectedAccount'
import { AccountState, InternalPortfolioChain, NetworkState } from '../portfolio/interfaces'
import PortfolioViewBuilder from './portfolioView'

export const isInternalChain = (chainId: InternalPortfolioChain | string) => {
  return (
    chainId === 'gasTank' ||
    chainId === 'rewards' ||
    chainId === 'projectedRewards' ||
    chainId === 'defiApps' ||
    // Not a chain at all - a plain string field on AccountState (see mobileInviteKey there).
    chainId === 'mobileInviteKey'
  )
}

export const stripPortfolioState = (portfolioState: AccountState) => {
  const strippedState: SelectedAccountPortfolioState = {}

  Object.keys(portfolioState).forEach((chainId) => {
    // Not a NetworkState - skip it here, same reason as in PortfolioViewBuilder.addNetworkData.
    if (chainId === 'mobileInviteKey') return

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
      collectionErrors,
      toBeLearned,
      lastExternalApiUpdateData,
      tokenDataCache,
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
              nonceId: defiPositions.nonceId,
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
  verification: null,
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

  // Iterating via Object.keys (like stripPortfolioState above) rather than Object.entries -
  // the latter widens every value to the union of ALL of AccountState's value types
  // (since it can't correlate a specific key to its specific value type), which would
  // include `mobileInviteKey`'s plain `string` even after the guard below. Indexing by a
  // generic `string` key instead resolves to just the chainId index signature's type.
  Object.keys(portfolioState).forEach((chainId) => {
    // Not a NetworkState - a plain string field on AccountState, read separately by
    // SelectedAccountController and merged onto SelectedAccountPortfolio directly.
    if (chainId === 'mobileInviteKey') return

    const networkData = portfolioState[chainId]
    portfolioViewBuilder.addNetworkData(chainId, networkData, isManualUpdate)
  })

  return portfolioViewBuilder.build(shouldShowPartialResult, strippedPortfolioState)
}
