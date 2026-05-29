import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters';
const getAssetValue = (amount, decimals, priceIn) => {
    if (!priceIn.length)
        return undefined;
    const priceInUSD = priceIn.find((p) => p.baseCurrency === 'usd')?.price;
    if (!priceInUSD)
        return undefined;
    const assetValueString = safeTokenAmountAndNumberMultiplication(amount, decimals, priceInUSD);
    return Number(assetValueString);
};
const isTokenPriceWithinHalfPercent = (price1, price2) => {
    const diff = Math.abs(price1 - price2);
    const threshold = 0.005 * Math.max(Math.abs(price1), Math.abs(price2));
    return diff <= threshold;
};
const getProviderId = (providerName) => {
    return providerName.toLowerCase();
};
export { getAssetValue, getProviderId, isTokenPriceWithinHalfPercent };
//# sourceMappingURL=helpers.js.map