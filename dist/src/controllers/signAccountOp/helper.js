"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFeeTokenPriceUnavailableWarning = exports.getSignificantBalanceDecreaseWarning = exports.getTokenUsdAmount = exports.getFeeSpeedIdentifier = void 0;
const ethers_1 = require("ethers");
const errorHandling_1 = require("../../consts/signAccountOp/errorHandling");
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
function getSignificantBalanceDecreaseWarning(latest, pending, networkId) {
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
        return errorHandling_1.WARNINGS.significantBalanceDecrease;
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