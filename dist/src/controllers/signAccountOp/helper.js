import { formatUnits, ZeroAddress } from 'ethers';
import { WARNINGS } from '../../consts/signAccountOp/errorHandling';
import { getAccountPortfolioTotal, getTotal } from '../../libs/portfolio/helpers';
function getFeeSpeedIdentifier(option, accountAddr, rbfAccountOp) {
    // if the token is native and we're paying with EOA, we do not need
    // a different identifier as the fee speed calculations will be the same
    // regardless of the EOA address
    const paidBy = option.token.address === ZeroAddress && option.paidBy !== accountAddr ? 'EOA' : option.paidBy;
    return `${paidBy}:${option.token.address}:${option.token.symbol.toLowerCase()}:${option.token.flags.onGasTank ? 'gasTank' : 'feeToken'}${rbfAccountOp ? `rbf-${option.paidBy}` : ''}`;
}
function getTokenUsdAmount(token, gasAmount) {
    const isUsd = (price) => price.baseCurrency === 'usd';
    const usdPrice = token.priceIn.find(isUsd)?.price;
    if (!usdPrice)
        return '';
    const usdPriceFormatted = BigInt(usdPrice * 1e18);
    // 18 it's because we multiply usdPrice * 1e18 and here we need to deduct it
    return formatUnits(BigInt(gasAmount) * usdPriceFormatted, 18 + token.decimals);
}
function getSignificantBalanceDecreaseWarning(latest, pending, networkId) {
    const latestNetworkData = latest?.[networkId];
    const pendingNetworkData = pending?.[networkId];
    const canDetermineIfBalanceWillDecrease = latestNetworkData &&
        !latestNetworkData.isLoading &&
        pendingNetworkData &&
        !pendingNetworkData.isLoading;
    if (canDetermineIfBalanceWillDecrease) {
        const latestTotal = getAccountPortfolioTotal(latest, ['rewards', 'gasTank'], false);
        const latestOnNetwork = getTotal(latestNetworkData.result?.tokens || []).usd;
        const pendingOnNetwork = getTotal(pendingNetworkData.result?.tokens || []).usd;
        const willBalanceDecreaseByMoreThan10Percent = latestOnNetwork - pendingOnNetwork > latestTotal * 0.1;
        if (!willBalanceDecreaseByMoreThan10Percent)
            return null;
        return WARNINGS.significantBalanceDecrease;
    }
    return null;
}
const getFeeTokenPriceUnavailableWarning = (hasSpeed, feeTokenHasPrice) => {
    if (!hasSpeed || feeTokenHasPrice)
        return null;
    return WARNINGS.feeTokenPriceUnavailable;
};
export { getFeeSpeedIdentifier, getTokenUsdAmount, getSignificantBalanceDecreaseWarning, getFeeTokenPriceUnavailableWarning };
//# sourceMappingURL=helper.js.map