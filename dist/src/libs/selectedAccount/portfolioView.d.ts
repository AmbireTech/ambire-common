import { SelectedAccountPortfolio, SelectedAccountPortfolioState } from '../../interfaces/selectedAccount';
import { InternalPortfolioChain, NetworkState } from '../portfolio/interfaces';
/**
 * Constructs the view state of the portfolio from all network data
 */
export default class PortfolioViewBuilder {
    private tokens;
    private defiPositions;
    private collections;
    private totalBalance;
    private balancePerNetwork;
    private networkSimulatedAccountOp;
    private isAllReady;
    private isReloading;
    /**
     * If there is an emit update from the portfolio where only the additional
     * portfolio has loaded (gasTank, rewards etc.) we shouldn't flip isAllReady to true
     * as regular networks are not loaded yet. When there is at least one non-internal
     * network, we start calculating isAllReady normally.
     */
    private isNonInternalNetworkAdded;
    private static isNetworkReady;
    /**
     * Checks if network data is loading from scratch (first load or manual update)
     */
    private static isLoadingFromScratch;
    /**
     * Checks if network should be marked as reloading based on last update timestamp
     */
    private static shouldMarkAsReloading;
    /**
     * Checks if network is ready for display
     */
    private static isNetworkDisplayReady;
    /**
     * Checks for visible non-zero tokens
     */
    private static hasVisibleTokens;
    /**
     * Add a network's data to the portfolio view
     */
    addNetworkData(chainId: InternalPortfolioChain | string, networkData: NetworkState | undefined, isManualUpdate: boolean): void;
    build(shouldShowPartialResult: boolean, strippedPortfolioState: SelectedAccountPortfolioState): SelectedAccountPortfolio;
}
//# sourceMappingURL=portfolioView.d.ts.map