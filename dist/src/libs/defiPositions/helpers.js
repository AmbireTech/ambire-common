"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssetValue = exports.sortByValue = void 0;
const formatters_1 = require("../../utils/numbers/formatters");
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
exports.sortByValue = sortByValue;
const getAssetValue = (amount, decimals, priceIn) => {
    if (!priceIn.length)
        return undefined;
    const priceInUSD = priceIn.find((p) => p.baseCurrency === 'usd')?.price;
    if (!priceInUSD)
        return undefined;
    const assetValueString = (0, formatters_1.safeTokenAmountAndNumberMultiplication)(amount, decimals, priceInUSD);
    return Number(assetValueString);
};
exports.getAssetValue = getAssetValue;
//# sourceMappingURL=helpers.js.map