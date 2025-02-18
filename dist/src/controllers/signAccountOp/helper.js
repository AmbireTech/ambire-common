"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFeeTokenPriceUnavailableWarning = exports.getSignificantBalanceDecreaseWarning = exports.getTokenUsdAmount = exports.getFeeSpeedIdentifier = void 0;
const ethers_1 = require("ethers");
const errorHandling_1 = require("../../consts/signAccountOp/errorHandling");
const signAccountOp_1 = require("../../interfaces/signAccountOp");
const helpers_1 = require("../../libs/portfolio/helpers");
function getFeeSpeedIdentifier(option, accountAddr, rbfAccountOp) {
    // if the token is native and we're paying with EOA, we do not need
    // a different identifier as the fee speed calculations will be the same
    // regardless of the EOA address
    const paidBy = option.token.address === ethers_1.ZeroAddress && option.paidBy !== accountAddr ? 'EOA' : option.paidBy;
    return `${paidBy}:${option.token.address}:${option.token.symbol.toLowerCase()}:${option.token.flags.onGasTank ? 'gasTank' : 'feeToken'}${rbfAccountOp ? `rbf-${option.paidBy}` : ''}`;
}
exports.getFeeSpeedIdentifier = getFeeSpeedIdentifier;
function getTokenUsdAmount(token, gasAmount) {
    const isUsd = (price) => price.baseCurrency === 'usd';
    const usdPrice = token.priceIn.find(isUsd)?.price;
    if (!usdPrice)
        return '';
    const usdPriceFormatted = BigInt(usdPrice * 1e18);
    // 18 it's because we multiply usdPrice * 1e18 and here we need to deduct it
    return (0, ethers_1.formatUnits)(BigInt(gasAmount) * usdPriceFormatted, 18 + token.decimals);
}
exports.getTokenUsdAmount = getTokenUsdAmount;
function getSignificantBalanceDecreaseWarning(latest, pending, networkId, traceCallDiscoveryStatus) {
    const latestNetworkData = latest?.[networkId];
    const pendingNetworkData = pending?.[networkId];
    const canDetermineIfBalanceWillDecrease = latestNetworkData &&
        !latestNetworkData.isLoading &&
        pendingNetworkData &&
        !pendingNetworkData.isLoading;
    if (canDetermineIfBalanceWillDecrease) {
        const latestTotal = (0, helpers_1.getAccountPortfolioTotal)(latest, ['rewards', 'gasTank'], false);
        const latestOnNetwork = (0, helpers_1.getTotal)(latestNetworkData.result?.tokens || []).usd;
        const pendingOnNetwork = (0, helpers_1.getTotal)(pendingNetworkData.result?.tokens || []).usd;
        const willBalanceDecreaseByMoreThan10Percent = latestOnNetwork - pendingOnNetwork > latestTotal * 0.1;
        if (!willBalanceDecreaseByMoreThan10Percent)
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
exports.getSignificantBalanceDecreaseWarning = getSignificantBalanceDecreaseWarning;
const getFeeTokenPriceUnavailableWarning = (hasSpeed, feeTokenHasPrice) => {
    if (!hasSpeed || feeTokenHasPrice)
        return null;
    return errorHandling_1.WARNINGS.feeTokenPriceUnavailable;
};
exports.getFeeTokenPriceUnavailableWarning = getFeeTokenPriceUnavailableWarning;
//# sourceMappingURL=helper.js.map