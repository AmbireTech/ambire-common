import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState
} from '../../interfaces/selectedAccount'
import { AccountOp } from '../accountOp/accountOp'
import { PositionsByProvider } from '../defiPositions/types'
import { CollectionResult, TokenResult } from '../portfolio'
import {
  NetworkState,
  PortfolioGasTankResult,
  PortfolioNetworkResult,
  PortfolioRewardsResult
} from '../portfolio/interfaces'

/**
 * Constructs the view state of the portfolio from all network data
 */
export default class PortfolioViewBuilder {
  private tokens: TokenResult[] = []

  private defiPositions: PositionsByProvider[] = []

  private collections: CollectionResult[] = []

  private totalBalance = 0

  private balancePerNetwork: Record<string, number> = {}

  private networkSimulatedAccountOp: Record<string, AccountOp> = {}

  private isAllReady = true

  private isReloading = false

  /**
   * If there is an emit update from the portfolio where only the additional
   * portfolio has loaded (gasTank, rewards etc.) we shouldn't flip isAllReady to true
   * as regular networks are not loaded yet. When there is at least one non-internal
   * network, we start calculating isAllReady normally.
   */
  private isNonInternalNetworkAdded = false

  private static isNetworkReady = (networkData: NetworkState | undefined) => {
    return networkData && (networkData.isReady || networkData?.criticalError)
  }

  /**
   * Checks if network data is loading from scratch (first load or manual update)
   */
  private static isLoadingFromScratch(
    networkData: NetworkState | undefined,
    isManualUpdate: boolean
  ): boolean {
    return (
      (!PortfolioViewBuilder.isNetworkReady(networkData) || isManualUpdate) &&
      !!networkData?.isLoading
    )
  }

  /**
   * Checks if network should be marked as reloading based on last update timestamp
   */
  private static shouldMarkAsReloading(networkData: NetworkState | undefined): boolean {
    if (
      !networkData?.result ||
      !networkData?.isLoading ||
      !('lastSuccessfulUpdate' in networkData.result) ||
      !networkData?.result?.lastSuccessfulUpdate
    ) {
      return false
    }

    const ONE_HOUR_MS = 60 * 60 * 1000
    const oneHourAgo = Date.now() - ONE_HOUR_MS
    return networkData.result.lastSuccessfulUpdate < oneHourAgo
  }

  /**
   * Checks if network is ready for display
   */
  private static isNetworkDisplayReady(
    networkData: NetworkState | undefined,
    isLoadingFromScratch: boolean
  ): boolean {
    return !!(
      networkData &&
      PortfolioViewBuilder.isNetworkReady(networkData) &&
      !isLoadingFromScratch
    )
  }

  /**
   * Checks for visible non-zero tokens
   */
  private static hasVisibleTokens(tokens: TokenResult[]): boolean {
    return tokens.some((t) => t.amount > 0n && !t.flags.isHidden)
  }

  /**
   * Add a network's data to the portfolio view
   */
  addNetworkData(
    chainId: string,
    networkData: NetworkState | undefined,
    isManualUpdate: boolean
  ): void {
    if (chainId === 'projectedRewards') {
      return
    }
    if (chainId !== 'gasTank' && chainId !== 'rewards') {
      this.isNonInternalNetworkAdded = true
    }

    if (!networkData) {
      this.isAllReady = false
      return
    }

    const networkResult = networkData.result as
      | PortfolioGasTankResult
      | PortfolioRewardsResult
      | PortfolioNetworkResult
    const loadingFromScratch = PortfolioViewBuilder.isLoadingFromScratch(
      networkData,
      isManualUpdate
    )

    this.tokens.push(...(networkResult?.tokens || []))
    if (networkResult && 'defiPositions' in networkResult) {
      this.defiPositions.push(...(networkResult?.defiPositions?.positionsByProvider || []))
    }

    if (networkResult && 'collections' in networkResult) {
      this.collections.push(...(networkResult?.collections || []))
    }

    const accountOp = networkData.accountOps?.[0]
    if (accountOp) {
      this.networkSimulatedAccountOp[chainId] = accountOp
    }

    const networkBalance = networkResult?.total?.usd || 0
    this.totalBalance += networkBalance
    this.balancePerNetwork[chainId] = networkBalance

    if (!PortfolioViewBuilder.isNetworkDisplayReady(networkData, loadingFromScratch)) {
      this.isAllReady = false
    }

    if (PortfolioViewBuilder.shouldMarkAsReloading(networkData)) {
      this.isReloading = true
    }
  }

  build(
    shouldShowPartialResult: boolean,
    strippedPortfolioState: SelectedAccountPortfolioState
  ): SelectedAccountPortfolio {
    if (!this.isNonInternalNetworkAdded) {
      this.isAllReady = false
    }

    const hasVisibleTokens = PortfolioViewBuilder.hasVisibleTokens(this.tokens)
    const isReadyToVisualize =
      this.isAllReady || (shouldShowPartialResult && hasVisibleTokens && !this.isAllReady)

    return {
      tokens: this.tokens,
      collections: this.collections,
      totalBalance: this.totalBalance,
      balancePerNetwork: this.balancePerNetwork,
      networkSimulatedAccountOp: this.networkSimulatedAccountOp,
      isAllReady: this.isAllReady,
      isReloading: this.isReloading,
      isReadyToVisualize,
      shouldShowPartialResult: this.isAllReady ? false : shouldShowPartialResult,
      projectedRewardsStats: null,
      portfolioState: strippedPortfolioState,
      defiPositions: this.defiPositions.sort((a, b) => {
        if (b.providerName === 'Ambire' && a.providerName !== 'Ambire') return 1
        if (a.providerName === 'Ambire' && b.providerName !== 'Ambire') return -1
        return (b.positionInUSD || 0) - (a.positionInUSD || 0)
      })
    }
  }
}
