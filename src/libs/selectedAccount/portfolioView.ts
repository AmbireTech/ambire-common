import { ACCOUNT_DATA_DISPLAY_MAX_AGE } from '../../consts/account'
import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState,
  SelectedAccountPortfolioVerification,
  SelectedAccountPositionsByProvider
} from '../../interfaces/selectedAccount'
import { AccountOp } from '../accountOp/accountOp'
import { DefiValues, PositionsByProvider } from '../defiPositions/types'
import { CollectionResult, TokenResult } from '../portfolio'
import {
  InternalPortfolioChain,
  NetworkState,
  PortfolioDefiAppsResult,
  PortfolioGasTankResult,
  PortfolioNetworkResult,
  PortfolioRewardsResult
} from '../portfolio/interfaces'

type NetworkResult =
  | PortfolioGasTankResult
  | PortfolioRewardsResult
  | PortfolioNetworkResult
  | PortfolioDefiAppsResult

/**
 * Constructs the view state of the portfolio from all network data
 */
export default class PortfolioViewBuilder {
  private tokens: TokenResult[] = []

  private defiPositions: SelectedAccountPositionsByProvider[] = []

  private collections: CollectionResult[] = []

  private totalBalance = 0

  private balancePerNetwork: Record<string, number> = {}

  private networkSimulatedAccountOp: Record<string, AccountOp> = {}

  private isAllReady = true

  private isReloading = false

  private verification: SelectedAccountPortfolioVerification | null = null

  private walletStaking?: PortfolioNetworkResult['walletStaking']

  /**
   * If there is an emit update from the portfolio where only the additional
   * portfolio has loaded (gasTank, rewards etc.) we shouldn't flip isAllReady to true
   * as regular networks are not loaded yet. When there is at least one non-internal
   * network, we start calculating isAllReady normally.
   */
  private isNonInternalNetworkAdded = false

  private shouldSubtractBorrowedFunds: boolean

  constructor(shouldSubtractBorrowedFunds: boolean) {
    this.shouldSubtractBorrowedFunds = shouldSubtractBorrowedFunds
  }

  /**
   * What a DeFi app or position adds to the total balance. It is its value with the loans
   * subtracted when the user chose so, and its full collateral otherwise.
   */
  private getDefiBalance({ positionInUSD = 0, collateralInUSD = positionInUSD }: DefiValues) {
    return this.shouldSubtractBorrowedFunds ? positionInUSD : collateralInUSD
  }

  /**
   * The app's balance follows the setting, like the total. Its positions always show what they
   * supplied, as they list the loans that are subtracted from the app's balance
   */
  private withBalance(provider: PositionsByProvider): SelectedAccountPositionsByProvider {
    return {
      ...provider,
      balanceInUSD: this.getDefiBalance(provider),
      positions: provider.positions.map((position) => ({
        ...position,
        balanceInUSD: PortfolioViewBuilder.getCollateralBalance(position.additionalData)
      }))
    }
  }

  /** The full collateral of a DeFi position, without its loans subtracted */
  private static getCollateralBalance({
    positionInUSD = 0,
    collateralInUSD = positionInUSD
  }: DefiValues) {
    return collateralInUSD
  }

  /**
   * The network's USD balance. The network total counts the DeFi apps with their loans
   * subtracted, so each app's difference to its balance is added to it.
   */
  private static getNetworkBalance(
    networkTotal: number,
    positionsByProvider: SelectedAccountPositionsByProvider[]
  ) {
    return positionsByProvider.reduce(
      (balance, provider) => balance + provider.balanceInUSD - (provider.positionInUSD || 0),
      networkTotal
    )
  }

  private static isNetworkReady = (networkData: NetworkState | undefined) => {
    return networkData && (networkData.isReady || networkData?.criticalError)
  }

  /**
   * Checks if network data is loading from scratch (first load, manual update or a reload of
   * outdated assets)
   */
  private static isLoadingFromScratch(
    networkData: NetworkState | undefined,
    isManualUpdate: boolean
  ): boolean {
    return (
      ((!PortfolioViewBuilder.isNetworkReady(networkData) || isManualUpdate) &&
        !!networkData?.isLoading) ||
      PortfolioViewBuilder.isReloadingOutdatedAssets(networkData)
    )
  }

  /**
   * Whether the network's assets are older than ACCOUNT_DATA_DISPLAY_MAX_AGE and are being
   * fetched again, so they aren't shown until then. A network without assets has nothing to hide.
   */
  private static isReloadingOutdatedAssets(networkData: NetworkState | undefined): boolean {
    if (!networkData?.result || !PortfolioViewBuilder.shouldMarkAsReloading(networkData)) {
      return false
    }

    const result = networkData.result as NetworkResult
    const hasDefiPositions =
      'defiPositions' in result && !!result.defiPositions?.positionsByProvider?.length

    return hasDefiPositions || PortfolioViewBuilder.hasVisibleTokens(result.tokens || [])
  }

  /**
   * Checks if network should be marked as reloading based on last update timestamp
   */
  private static shouldMarkAsReloading(networkData: NetworkState | undefined): boolean {
    if (!networkData?.result || !networkData?.isLoading || !networkData?.lastSuccessfulUpdate) {
      return false
    }

    return Date.now() - networkData.lastSuccessfulUpdate > ACCOUNT_DATA_DISPLAY_MAX_AGE
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

  private addVerificationData(chainId: string, networkData: NetworkState): void {
    if (!networkData.verification) return

    if (!this.verification) {
      this.verification = {
        provider: networkData.verification.provider,
        status: networkData.verification.status,
        blockDiff: networkData.verification.blockDiff,
        verifiedChains: [],
        failedChains: []
      }
    }

    if (networkData.verification.status === 'success') {
      this.verification.verifiedChains.push(chainId)
    }

    if (networkData.verification.status === 'warning') {
      this.verification.failedChains.push(chainId)
    }

    if (networkData.verification.status === 'stale') {
      this.verification.blockDiff = Math.max(
        this.verification.blockDiff || 0,
        networkData.verification.blockDiff || 0
      )
    }

    if (this.verification.status === 'warning') return

    if (networkData.verification.status === 'warning') {
      this.verification.status = 'warning'
      return
    }

    if (this.verification.status === 'stale') return

    if (networkData.verification.status === 'stale') {
      this.verification.status = 'stale'
      return
    }

    if (this.verification.status === 'loading') return

    if (networkData.verification.status === 'loading') {
      this.verification.status = 'loading'
      return
    }

    this.verification.status = 'success'
  }

  /**
   * Add a network's data to the portfolio view
   */
  addNetworkData(
    chainId: InternalPortfolioChain | string,
    networkData: NetworkState | undefined,
    isManualUpdate: boolean
  ): void {
    if (chainId !== 'gasTank' && chainId !== 'rewards' && chainId !== 'defiApps') {
      this.isNonInternalNetworkAdded = true
    }

    if (!networkData) {
      this.isAllReady = false
      return
    }

    this.addVerificationData(chainId, networkData)

    const loadingFromScratch = PortfolioViewBuilder.isLoadingFromScratch(
      networkData,
      isManualUpdate
    )
    // A network that loads from scratch shows nothing, not its old data next to the skeleton
    const isNetworkDataHidden =
      loadingFromScratch || !PortfolioViewBuilder.isNetworkReady(networkData)
    const networkResult = (isNetworkDataHidden ? undefined : networkData.result) as NetworkResult

    const positionsByProvider =
      networkResult && 'defiPositions' in networkResult
        ? (networkResult.defiPositions?.positionsByProvider || []).map((provider) =>
            this.withBalance(provider)
          )
        : []

    this.tokens.push(...(networkResult?.tokens || []))
    this.defiPositions.push(...positionsByProvider)

    if (networkResult && 'collections' in networkResult) {
      this.collections.push(...(networkResult?.collections || []))
    }

    if (networkResult && 'walletStaking' in networkResult && networkResult.walletStaking) {
      this.walletStaking = networkResult.walletStaking
    }

    const accountOp = networkData.accountOps?.[0]
    if (accountOp) {
      this.networkSimulatedAccountOp[chainId] = accountOp
    }

    const networkBalance = PortfolioViewBuilder.getNetworkBalance(
      networkResult?.total?.usd || 0,
      positionsByProvider
    )
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
    const isReadyToVisualize = this.isAllReady || (shouldShowPartialResult && hasVisibleTokens)

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
      walletStaking: this.walletStaking,
      verification: this.verification,
      portfolioState: strippedPortfolioState,
      defiPositions: this.defiPositions.sort((a, b) => {
        if (b.providerName === 'Ambire' && a.providerName !== 'Ambire') return 1
        if (a.providerName === 'Ambire' && b.providerName !== 'Ambire') return -1
        return b.balanceInUSD - a.balanceInUSD
      })
    }
  }
}
