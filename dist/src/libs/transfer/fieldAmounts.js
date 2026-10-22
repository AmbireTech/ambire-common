"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAmountsFromFieldValue = void 0;
const ethers_1 = require("ethers");
const swapAndBridge_1 = require("../../consts/swapAndBridge");
const formatters_1 = require("../../utils/numbers/formatters");
const amount_1 = require("./amount");
// Precision of a typed USD amount before conversion
const FIAT_FIELD_DECIMALS = 10;
/**
 * Token and USD amounts of a Send amount field, typed in either. With no price, the input is the
 * token amount and there is no USD value. An empty input gives empty amounts.
 */
const getAmountsFromFieldValue = ({ fieldValue, fieldMode, price, decimals }) => {
    if (!fieldValue)
        return { amount: '', amountInFiat: '' };
    if (!price)
        return { amount: fieldValue, amountInFiat: '' };
    const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(price);
    if (fieldMode === 'fiat') {
        const sanitizedFiat = (0, amount_1.getSanitizedAmount)(fieldValue, FIAT_FIELD_DECIMALS);
        const amountInFiatBigInt = sanitizedFiat ? (0, ethers_1.parseUnits)(sanitizedFiat, FIAT_FIELD_DECIMALS) : 0n;
        return {
            amount: (0, ethers_1.formatUnits)((amountInFiatBigInt * swapAndBridge_1.CONVERSION_PRECISION_POW) / tokenPriceBigInt, 
            // Shift the decimal point by the number of decimals in the token price
            FIAT_FIELD_DECIMALS + swapAndBridge_1.CONVERSION_PRECISION - tokenPriceDecimals),
            amountInFiat: fieldValue
        };
    }
    const tokenAmount = (0, ethers_1.parseUnits)((0, formatters_1.getSafeAmountFromFieldValue)(fieldValue, decimals), decimals);
    return {
        amount: fieldValue,
        // The fiat field shows this as-is when switched to, so cut it down to a displayable
        // precision instead of the token's full one (up to 18 decimals)
        amountInFiat: (0, formatters_1.truncateFiatAmountDecimals)((0, ethers_1.formatUnits)(tokenAmount * tokenPriceBigInt, 
        // Shift the decimal point by the number of decimals in the token price
        decimals + tokenPriceDecimals))
    };
};
exports.getAmountsFromFieldValue = getAmountsFromFieldValue;
//# sourceMappingURL=fieldAmounts.js.map