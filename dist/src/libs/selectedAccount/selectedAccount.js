"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSelectedAccountPortfolio = exports.isNetworkReady = exports.updatePortfolioStateWithDefiPositions = void 0;
const ethers_1 = require("ethers");
const formatters_1 = require("../../utils/numbers/formatters");
const types_1 = require("../defiPositions/types");
const updatePortfolioStateWithDefiPositions = (portfolioAccountState, defiPositionsAccountState, areDefiPositionsLoading) => {
    if (!portfolioAccountState || !defiPositionsAccountState || areDefiPositionsLoading)
        return portfolioAccountState;
    Object.keys(portfolioAccountState).forEach((networkId) => {
        const networkState = portfolioAccountState[networkId];
        if (!networkState?.result || defiPositionsAccountState[networkId]?.isLoading)
            return;
        let tokens = networkState.result.tokens || [];
        let networkBalance = networkState.result.total?.usd || 0;
        const positions = defiPositionsAccountState[networkId] || {};
        positions.positionsByProvider?.forEach((posByProv) => {
            if (posByProv.type === 'liquidity-pool') {
                networkBalance += posByProv.positionInUSD || 0;
                return;
            }
            posByProv.positions.forEach((pos) => {
                pos.assets
                    .filter((a) => a.type !== types_1.AssetType.Liquidity && a.protocolAsset)
                    .forEach((a) => {
                    const tokenInPortfolioIndex = tokens.findIndex((t) => {
                        return ((0, ethers_1.getAddress)(t.address) === (0, ethers_1.getAddress)(a.protocolAsset.address) &&
                            t.networkId === networkId);
                    });
                    if (tokenInPortfolioIndex !== -1) {
                        const tokenInPortfolio = tokens[tokenInPortfolioIndex];
                        const priceUSD = tokenInPortfolio.priceIn.find(({ baseCurrency }) => baseCurrency.toLowerCase() === 'usd')?.price;
                        const tokenBalanceUSD = priceUSD
                            ? Number((0, formatters_1.safeTokenAmountAndNumberMultiplication)(BigInt(tokenInPortfolio.amount), tokenInPortfolio.decimals, priceUSD))
                            : undefined;
                        networkBalance -= tokenBalanceUSD || 0; // deduct portfolio token balance
                        tokens = tokens.filter((_, index) => index !== tokenInPortfolioIndex);
                    }
                    // Add only the balance of the collateral tokens to the network balance
                    if (a.type === types_1.AssetType.Collateral) {
                        const protocolPriceUSD = a.priceIn.find(({ baseCurrency }) => baseCurrency.toLowerCase() === 'usd')?.price;
                        const protocolTokenBalanceUSD = protocolPriceUSD
                            ? Number((0, formatters_1.safeTokenAmountAndNumberMultiplication)(BigInt(a.amount), Number(a.protocolAsset.decimals), protocolPriceUSD))
                            : undefined;
                        networkBalance += protocolTokenBalanceUSD || 0;
                    }
                    tokens.push({
                        amount: a.amount,
                        // Only list the borrowed asset with no price
                        priceIn: a.type === types_1.AssetType.Collateral ? a.priceIn : [],
                        decimals: Number(a.protocolAsset.decimals),
                        address: a.protocolAsset.address,
                        symbol: a.protocolAsset.symbol,
                        networkId,
                        flags: {
                            canTopUpGasTank: false,
                            isFeeToken: false,
                            onGasTank: false,
                            rewardsType: null
                        }
                    });
                });
            });
        });
        // eslint-disable-next-line no-param-reassign
        portfolioAccountState[networkId].result.total.usd = networkBalance;
        // eslint-disable-next-line no-param-reassign
        portfolioAccountState[networkId].result.tokens = tokens;
    });
    return portfolioAccountState;
};
exports.updatePortfolioStateWithDefiPositions = updatePortfolioStateWithDefiPositions;
const stripPortfolioState = (portfolioState) => {
    const strippedState = {};
    Object.keys(portfolioState).forEach((networkId) => {
        const networkState = portfolioState[networkId];
        if (!networkState)
            return;
        if (!networkState.result) {
            strippedState[networkId] = networkState;
            return;
        }
        // A trick to exclude specific keys
        const { tokens, collections, tokenErrors, priceCache, hintsFromExternalAPI, ...result } = networkState.result;
        strippedState[networkId] = {
            ...networkState,
            result
        };
    });
    return strippedState;
};
const isNetworkReady = (networkData) => {
    return (networkData && (networkData.isReady || networkData?.criticalError) && !networkData.isLoading);
};
exports.isNetworkReady = isNetworkReady;
const calculateTokenArray = (networkId, latestTokens, pendingTokens, isPendingValid) => {
    if (networkId === 'gasTank' || networkId === 'rewards') {
        return latestTokens;
    }
    // If the pending state is older or there are no pending tokens
    // we shouldn't trust it to build the tokens array
    if (isPendingValid && pendingTokens.length) {
        return pendingTokens.map((pendingToken) => {
            const latestToken = latestTokens.find((latest) => {
                return latest.address === pendingToken.address;
            });
            return {
                ...pendingToken,
                latestAmount: latestToken?.amount,
                pendingAmount: pendingToken.amount
            };
        });
    }
    // Add only latestAmount to the tokens
    return latestTokens.map((token) => {
        return {
            ...token,
            latestAmount: token.amount
        };
    });
};
function calculateSelectedAccountPortfolio(latestStateSelectedAccount, pendingStateSelectedAccount, accountPortfolio, hasSignAccountOp) {
    const collections = [];
    const tokens = [];
    let newTotalBalance = 0;
    const hasLatest = latestStateSelectedAccount && Object.keys(latestStateSelectedAccount).length;
    let allReady = !!hasLatest;
    const hasPending = pendingStateSelectedAccount && Object.keys(pendingStateSelectedAccount).length;
    if (!hasLatest && !hasPending) {
        return {
            tokens: accountPortfolio?.tokens || [],
            collections: accountPortfolio?.collections || [],
            totalBalance: accountPortfolio?.totalBalance || 0,
            isAllReady: false,
            networkSimulatedAccountOp: accountPortfolio?.networkSimulatedAccountOp || {},
            latest: latestStateSelectedAccount,
            pending: pendingStateSelectedAccount
        };
    }
    let selectedAccountData = latestStateSelectedAccount;
    /**
     * Replaces the latest state if the following conditions are true:
     * - There is no critical error in the pending state.
     * - The pending block number is newer than the latest OR we have a signed acc op (because of simulation).
     */
    const validSelectedAccountPendingState = {};
    const simulatedAccountOps = {};
    Object.keys(pendingStateSelectedAccount).forEach((network) => {
        const pendingNetworkData = pendingStateSelectedAccount[network];
        const latestNetworkData = latestStateSelectedAccount[network];
        // Compare the block numbers to determine if the pending state is newer
        if (latestNetworkData?.result?.blockNumber && pendingNetworkData?.result?.blockNumber) {
            const isPendingNewer = pendingNetworkData.result.blockNumber >= latestNetworkData.result.blockNumber;
            if (!pendingNetworkData.criticalError && (isPendingNewer || hasSignAccountOp)) {
                validSelectedAccountPendingState[network] = pendingNetworkData;
            }
        }
        // Store the simulated account op
        const accountOp = pendingNetworkData?.accountOps?.[0];
        if (accountOp) {
            simulatedAccountOps[network] = accountOp;
        }
    });
    if (hasPending && Object.keys(validSelectedAccountPendingState).length > 0) {
        selectedAccountData = {
            ...selectedAccountData,
            ...validSelectedAccountPendingState
        };
    }
    Object.keys(selectedAccountData).forEach((network) => {
        const networkData = selectedAccountData[network];
        const result = networkData?.result;
        if (networkData && (0, exports.isNetworkReady)(networkData) && result) {
            const networkTotal = Number(result?.total?.usd) || 0;
            newTotalBalance += networkTotal;
            const latestTokens = latestStateSelectedAccount[network]?.result?.tokens || [];
            const pendingTokens = pendingStateSelectedAccount[network]?.result?.tokens || [];
            const networkCollections = result?.collections || [];
            const tokensArray = calculateTokenArray(network, latestTokens, pendingTokens, !!validSelectedAccountPendingState[network]);
            tokens.push(...tokensArray);
            collections.push(...networkCollections);
        }
        if (!(0, exports.isNetworkReady)(networkData)) {
            allReady = false;
        }
    });
    return {
        totalBalance: newTotalBalance,
        tokens,
        collections,
        isAllReady: allReady,
        networkSimulatedAccountOp: simulatedAccountOps,
        latest: stripPortfolioState(latestStateSelectedAccount),
        pending: stripPortfolioState(pendingStateSelectedAccount)
    };
}
exports.calculateSelectedAccountPortfolio = calculateSelectedAccountPortfolio;
//# sourceMappingURL=selectedAccount.js.map