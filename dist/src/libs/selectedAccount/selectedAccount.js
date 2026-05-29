"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = exports.isNetworkReady = exports.stripPortfolioState = exports.isInternalChain = void 0;
exports.calculateSelectedAccountPortfolio = calculateSelectedAccountPortfolio;
const tslib_1 = require("tslib");
const portfolioView_1 = tslib_1.__importDefault(require("./portfolioView"));
const isInternalChain = (chainId) => {
    return (chainId === 'gasTank' ||
        chainId === 'rewards' ||
        chainId === 'projectedRewards' ||
        chainId === 'defiApps');
};
exports.isInternalChain = isInternalChain;
const stripPortfolioState = (portfolioState) => {
    const strippedState = {};
    Object.keys(portfolioState).forEach((chainId) => {
        const networkState = portfolioState[chainId];
        if (!networkState)
            return;
        if (!networkState.result) {
            strippedState[chainId] = {
                ...networkState,
                result: undefined
            };
            return;
        }
        // A trick to exclude specific keys
        const { tokens, collections, tokenErrors, collectionErrors, toBeLearned, lastExternalApiUpdateData, tokenDataCache, defiPositions, ...result } = networkState.result;
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
        };
    });
    return strippedState;
};
exports.stripPortfolioState = stripPortfolioState;
const isNetworkReady = (networkData) => {
    return networkData && (networkData.isReady || networkData?.criticalError);
};
exports.isNetworkReady = isNetworkReady;
exports.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = {
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
};
/**
 * Calculates the selected account portfolio that is used by the UI
 */
function calculateSelectedAccountPortfolio(portfolioState, shouldShowPartialResult, isManualUpdate) {
    const strippedPortfolioState = (0, exports.stripPortfolioState)(portfolioState);
    if (Object.keys(portfolioState).length === 0) {
        return exports.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO;
    }
    const portfolioViewBuilder = new portfolioView_1.default();
    Object.entries(portfolioState).forEach(([chainId, networkData]) => {
        portfolioViewBuilder.addNetworkData(chainId, networkData, isManualUpdate);
    });
    return portfolioViewBuilder.build(shouldShowPartialResult, strippedPortfolioState);
}
//# sourceMappingURL=selectedAccount.js.map