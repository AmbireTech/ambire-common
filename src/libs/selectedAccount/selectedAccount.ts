import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState
} from '../../interfaces/selectedAccount'
import { AccountState, InternalPortfolioChain, NetworkState } from '../portfolio/interfaces'
import { addPendingDeliveryAmounts, PendingDeliveries } from '../swapAndBridge/pendingDeliveries'
import PortfolioViewBuilder from './portfolioView'

export const isInternalChain = (chainId: InternalPortfolioChain | string) => {
  return chainId === 'gasTank' || chainId === 'rewards' || chainId === 'defiApps'
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

    // A trick to exclude specific keys: these are large and the UI reads them from elsewhere
    // (the tokens and collections are built separately) or never, so they are left out of
    // the state that is sent to it on every update.
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      tokens,
      collections,
      tokenErrors,
      collectionErrors,
      toBeLearned,
      lastExternalApiUpdateData,
      defiPositions,
      ...result
    } = networkState.result
    /* eslint-enable @typescript-eslint/no-unused-vars */

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
  verification: null
}

/**
 * Calculates the selected account portfolio that is used by the UI. The tokens that in-progress
 * swaps and bridges will still move get their `pendingDeliveryAmount` from `pendingDeliveries`.
 * Always returns a new object, so the caller can add fields to it.
 */
export function calculateSelectedAccountPortfolio(
  portfolioState: AccountState,
  shouldShowPartialResult: boolean,
  isManualUpdate: boolean,
  shouldSubtractBorrowedFunds: boolean,
  pendingDeliveries: PendingDeliveries = {}
): SelectedAccountPortfolio {
  const strippedPortfolioState = stripPortfolioState(portfolioState)

  if (Object.keys(portfolioState).length === 0) {
    return { ...DEFAULT_SELECTED_ACCOUNT_PORTFOLIO }
  }

  const portfolioViewBuilder = new PortfolioViewBuilder(shouldSubtractBorrowedFunds)

  Object.entries(portfolioState).forEach(([chainId, networkData]) => {
    portfolioViewBuilder.addNetworkData(chainId, networkData, isManualUpdate)
  })

  const portfolio = portfolioViewBuilder.build(shouldShowPartialResult, strippedPortfolioState)

  return { ...portfolio, tokens: addPendingDeliveryAmounts(portfolio.tokens, pendingDeliveries) }
}
