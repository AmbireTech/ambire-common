"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUnderpriced = exports.getUnknownTokenWarning = exports.getFeeTokenPriceUnavailableWarning = void 0;
exports.getFeeSpeedIdentifier = getFeeSpeedIdentifier;
exports.getSafeDelegateCallWarning = getSafeDelegateCallWarning;
exports.getSafeGasRefundWarning = getSafeGasRefundWarning;
exports.getSignificantBalanceDecreaseWarning = getSignificantBalanceDecreaseWarning;
exports.getTokenUsdAmount = getTokenUsdAmount;
const errorHandling_1 = require("../../consts/signAccountOp/errorHandling");
const signAccountOp_1 = require("../../interfaces/signAccountOp");
const safeTxGasRefund_1 = require("../../libs/humanizer/erc7730/safeTxGasRefund");
const Safe_1 = require("../../libs/humanizer/modules/Safe");
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
function getSignificantBalanceDecreaseWarning(portfolioState, chainId, discoveryStatus) {
    const portfolioNetworkState = portfolioState?.[chainId.toString()];
    // calculate this only after traceCall has ended
    const isDiscoveryOver = discoveryStatus === signAccountOp_1.TraceCallDiscoveryStatus.Failed ||
        discoveryStatus === signAccountOp_1.TraceCallDiscoveryStatus.Done;
    if (portfolioNetworkState && portfolioNetworkState.result && isDiscoveryOver) {
        const totalInUSD = (0, helpers_1.getAccountPortfolioTotal)(portfolioState, ['rewards', 'gasTank'], false);
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
        return errorHandling_1.WARNINGS.significantBalanceDecrease;
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
const getFeeTokenPriceUnavailableWarning = (hasSpeed, feeTokenHasPrice, areTokenPricesEnabled) => {
    if (!areTokenPricesEnabled || !hasSpeed || feeTokenHasPrice)
        return null;
    return errorHandling_1.WARNINGS.feeTokenPriceUnavailable;
};
exports.getFeeTokenPriceUnavailableWarning = getFeeTokenPriceUnavailableWarning;
function getSafeDelegateCallWarning(accountOp) {
    if (!accountOp.safeTx)
        return null;
    const shouldWarn = (0, Safe_1.shouldDisplaySafeDelegateCallWarning)(BigInt(accountOp.safeTx.operation), accountOp.safeTx.to);
    return shouldWarn ? errorHandling_1.WARNINGS.safeDelegateCall : null;
}
// Reuses the same "sus" gas refund detection the humanizer already applies when a Safe signer
// signs the raw SafeTx message (see getSafeTxMessageWarnings in libs/humanizer/erc7730/humanize.ts),
// so the account-op level sign screen (i.e. signing with the Safe account itself) warns about it too.
// The wording is intentionally its own (not humanizer's getGasRefundWarning text) - this renders
// as a standalone banner with no adjacent visualization row, so it can't reference "the address
// below" or "what is shown above" and has to spell out the address itself.
function getSafeGasRefundWarning(accountOp) {
    if (!accountOp.safeTx)
        return null;
    const gasRefund = (0, safeTxGasRefund_1.buildSafeTxGasRefund)(accountOp.safeTx.baseGas, accountOp.safeTx.gasPrice, accountOp.safeTx.gasToken, accountOp.safeTx.refundReceiver);
    if (!gasRefund)
        return null;
    const text = gasRefund.refundReceiver
        ? `This transaction also sends a separate payment to ${gasRefund.refundReceiver} as a "gas refund", on top of the transaction itself. Only proceed if you expect this.`
        : `This transaction also sends a separate payment to whoever broadcasts it, as a "gas refund", on top of the transaction itself. Only proceed if you expect this.`;
    return {
        id: 'safeGasRefund',
        title: 'Suspicious gas refund detected',
        text
    };
}
const isUnderpriced = (msg) => {
    return (msg.includes('underpriced') ||
        msg.includes('Fee confirmation failed') ||
        msg.includes('maxFeePerGas') ||
        msg.includes('maxPriorityFeePerGas'));
};
exports.isUnderpriced = isUnderpriced;
//# sourceMappingURL=helper.js.map