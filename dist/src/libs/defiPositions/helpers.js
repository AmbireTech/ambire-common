import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters';
const sortByValue = (aValue, bValue) => {
    if (aValue && bValue) {
        return bValue - aValue;
    }
    if (aValue && !bValue) {
        return -1;
    }
    if (!aValue && bValue) {
        return 1;
    }
    return 0;
};
const getAssetValue = (amount, decimals, priceIn) => {
    if (!priceIn.length)
        return undefined;
    const priceInUSD = priceIn.find((p) => p.baseCurrency === 'usd')?.price;
    if (!priceInUSD)
        return undefined;
    const assetValueString = safeTokenAmountAndNumberMultiplication(amount, decimals, priceInUSD);
    return Number(assetValueString);
};
export { sortByValue, getAssetValue };
//# sourceMappingURL=helpers.js.map