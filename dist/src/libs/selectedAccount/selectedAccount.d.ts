import { SelectedAccountPortfolio, SelectedAccountPortfolioState } from '../../interfaces/selectedAccount';
import { AccountState, InternalPortfolioChain, NetworkState } from '../portfolio/interfaces';
export declare const isInternalChain: (chainId: InternalPortfolioChain | string) => chainId is "gasTank" | "rewards" | "defiApps" | "projectedRewards";
export declare const stripPortfolioState: (portfolioState: AccountState) => SelectedAccountPortfolioState;
export declare const isNetworkReady: (networkData: NetworkState | undefined) => boolean | import("../portfolio/interfaces").ExtendedError;
export declare const DEFAULT_SELECTED_ACCOUNT_PORTFOLIO: {
    tokens: any[];
    collections: any[];
    defiPositions: any[];
    tokenAmounts: any[];
    totalBalance: number;
    balancePerNetwork: {};
    isReadyToVisualize: boolean;
    isAllReady: boolean;
    shouldShowPartialResult: boolean;
    isReloading: boolean;
    networkSimulatedAccountOp: {};
    portfolioState: {};
    projectedRewardsStats: any;
};
/**
 * Calculates the selected account portfolio that is used by the UI
 */
export declare function calculateSelectedAccountPortfolio(portfolioState: AccountState, shouldShowPartialResult: boolean, isManualUpdate: boolean): SelectedAccountPortfolio;
//# sourceMappingURL=selectedAccount.d.ts.map