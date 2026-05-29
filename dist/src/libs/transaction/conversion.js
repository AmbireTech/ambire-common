"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAmountConversion = void 0;
const ethers_1 = require("ethers");
const formatters_1 = require("../../utils/numbers/formatters");
const amount_1 = require("../transfer/amount");
const CONVERSION_PRECISION = 16;
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION);
const handleFiatToTokenConversion = (amount, amountFormatted, tokenPrice, fromSelectedToken) => {
    if (typeof fromSelectedToken?.decimals !== 'number') {
        return { tokenAmount: '', fiatAmount: amount };
    }
    const amountInFiatDecimals = amount.split('.')[1]?.length || 0;
    const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(Number(tokenPrice));
    const amountInFiatBigInt = (0, ethers_1.parseUnits)(amountFormatted, amountInFiatDecimals);
    const tokenAmount = (0, ethers_1.formatUnits)((amountInFiatBigInt * CONVERSION_PRECISION_POW) / tokenPriceBigInt, amountInFiatDecimals + CONVERSION_PRECISION - tokenPriceDecimals);
    return { tokenAmount, fiatAmount: amount };
};
const handleTokenToFiatConversion = (amount, amountFormatted, tokenPrice, fromSelectedToken) => {
    if (!fromSelectedToken) {
        return { tokenAmount: amount, fiatAmount: '' };
    }
    const sanitizedFieldValue = (0, amount_1.getSanitizedAmount)(amountFormatted, fromSelectedToken.decimals);
    const formattedAmount = (0, ethers_1.parseUnits)(sanitizedFieldValue, fromSelectedToken.decimals);
    if (!formattedAmount) {
        return { tokenAmount: amount, fiatAmount: '' };
    }
    const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(Number(tokenPrice));
    const fiatAmount = (0, ethers_1.formatUnits)(formattedAmount * tokenPriceBigInt, fromSelectedToken.decimals + tokenPriceDecimals);
    return { tokenAmount: amount, fiatAmount };
};
const handleAmountConversion = (amount, amountFormatted, fromSelectedToken, isInFiatMode, hardCodedCurrency) => {
    if (amount === '') {
        return { tokenAmount: '', fiatAmount: '' };
    }
    const tokenPrice = fromSelectedToken?.priceIn.find((p) => p.baseCurrency === hardCodedCurrency)?.price;
    if (!tokenPrice) {
        return { tokenAmount: amount, fiatAmount: '' };
    }
    if (isInFiatMode) {
        return handleFiatToTokenConversion(amount, amountFormatted, String(tokenPrice), fromSelectedToken);
    }
    return handleTokenToFiatConversion(amount, amountFormatted, String(tokenPrice), fromSelectedToken);
};
exports.handleAmountConversion = handleAmountConversion;
//# sourceMappingURL=conversion.js.map