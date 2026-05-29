"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUnknownTokenWarning = exports.getFeeTokenPriceUnavailableWarning = void 0;
exports.getFeeSpeedIdentifier = getFeeSpeedIdentifier;
exports.getSignificantBalanceDecreaseWarning = getSignificantBalanceDecreaseWarning;
exports.getTokenUsdAmount = getTokenUsdAmount;
const errorHandling_1 = require("../../consts/signAccountOp/errorHandling");
const signAccountOp_1 = require("../../interfaces/signAccountOp");
const helpers_1 = require("../../libs/portfolio/helpers");
const formatters_1 = require("../../utils/numbers/formatters");
function getFeeSpeedIdentifier(option, accountAddr) {
    return `${option.paidBy}:${option.token.address}:${option.token.symbol.toLowerCase()}:${option.token.flags.onGasTank ? 'gasTank' : 'feeToken'}`;
}
function getTokenUsdAmount(token, gasAmount) {
    const isUsd = (price) => price.baseCurrency === 'usd';
    const usdPrice = token.priceIn.find(isUsd)?.price;
    if (!usdPrice)
        return '';
    return (0, formatters_1.safeTokenAmountAndNumberMultiplication)(gasAmount, token.decimals, usdPrice);
}
function getSignificantBalanceDecreaseWarning(portfolioState, chainId, traceCallDiscoveryStatus) {
    const portfolioNetworkState = portfolioState?.[chainId.toString()];
    if (portfolioNetworkState && portfolioNetworkState.result && !portfolioNetworkState.isLoading) {
        const totalInUSD = (0, helpers_1.getAccountPortfolioTotal)(portfolioState, ['rewards', 'gasTank', 'projectedRewards'], false);
        const simulatedTokens = portfolioNetworkState.result.tokens.filter((t) => typeof t.amountPostSimulation === 'bigint');
        if (!simulatedTokens.length)
            return null;
        // Calculates the amount on the pending block * the price of the token
        const simulatedTokensValueBeforeSimulationInUSD = (0, helpers_1.getTotal)(simulatedTokens, null, {
            includeHiddenTokens: true,
            beforeSimulation: true
        })?.usd;
        // Calculates the amount after the simulation * the price of the token
        const simulatedTokensValueAfterSimulationInUSD = (0, helpers_1.getTotal)(simulatedTokens, null, {
            includeHiddenTokens: true,
            beforeSimulation: false
        })?.usd;
        if (typeof simulatedTokensValueBeforeSimulationInUSD !== 'number' ||
            typeof simulatedTokensValueAfterSimulationInUSD !== 'number')
            return null;
        const absoluteDecreaseInUSD = simulatedTokensValueBeforeSimulationInUSD - simulatedTokensValueAfterSimulationInUSD;
        // In case the balance increased or stayed the same
        if (absoluteDecreaseInUSD <= 0)
            return null;
        const hasSignificantBalanceDecrease = absoluteDecreaseInUSD >= totalInUSD * 0.2 && absoluteDecreaseInUSD >= 1000;
        if (!hasSignificantBalanceDecrease)
            return null;
        // We wait for the discovery process (main.traceCall) to complete before showing WARNINGS.significantBalanceDecrease.
        // This is important because, in the case of a SWAP to a new token, the new token is not yet part of the portfolio,
        // which could incorrectly trigger a significant balance drop warning.
        // To prevent this, we ensure the discovery process is completed first.
        if (traceCallDiscoveryStatus === signAccountOp_1.TraceCallDiscoveryStatus.Done) {
            return errorHandling_1.WARNINGS.significantBalanceDecrease;
        }
        // If the discovery process takes too long (more than 2 seconds) or fails,
        // we still show a warning, but we indicate that our balance decrease assumption may be incorrect.
        if (traceCallDiscoveryStatus === signAccountOp_1.TraceCallDiscoveryStatus.Failed ||
            traceCallDiscoveryStatus === signAccountOp_1.TraceCallDiscoveryStatus.SlowPendingResponse) {
            return errorHandling_1.WARNINGS.possibleBalanceDecrease;
        }
    }
    return null;
}
const getUnknownTokenWarning = (pending, chainId) => {
    const networkData = pending?.[chainId.toString()];
    if (networkData?.isLoading)
        return null;
    const tokens = networkData?.result?.tokens || [];
    const hasUnknownTokens = tokens.some((t) => t.flags.suspectedType);
    return hasUnknownTokens ? errorHandling_1.WARNINGS.unknownToken : null;
};
exports.getUnknownTokenWarning = getUnknownTokenWarning;
const getFeeTokenPriceUnavailableWarning = (hasSpeed, feeTokenHasPrice) => {
    if (!hasSpeed || feeTokenHasPrice)
        return null;
    return errorHandling_1.WARNINGS.feeTokenPriceUnavailable;
};
exports.getFeeTokenPriceUnavailableWarning = getFeeTokenPriceUnavailableWarning;
//# sourceMappingURL=helper.js.map