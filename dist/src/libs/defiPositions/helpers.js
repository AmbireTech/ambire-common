"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTokenPriceWithinHalfPercent = exports.getProviderId = exports.getAssetValue = void 0;
const formatters_1 = require("../../utils/numbers/formatters");
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
const isTokenPriceWithinHalfPercent = (price1, price2) => {
    const diff = Math.abs(price1 - price2);
    const threshold = 0.005 * Math.max(Math.abs(price1), Math.abs(price2));
    return diff <= threshold;
};
exports.isTokenPriceWithinHalfPercent = isTokenPriceWithinHalfPercent;
const getProviderId = (providerName) => {
    return providerName.toLowerCase();
};
exports.getProviderId = getProviderId;
//# sourceMappingURL=helpers.js.map