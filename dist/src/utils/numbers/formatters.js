"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeTokenAmountAndNumberMultiplication = exports.convertTokenPriceToBigInt = void 0;
const ethers_1 = require("ethers");
/**
 * Converts floating point token price to big int
 */
const convertTokenPriceToBigInt = (tokenPrice) => {
    const tokenPriceString = String(tokenPrice);
    // Scientific notation handling
    if (tokenPriceString.includes('e')) {
        const [base, rawExponent] = tokenPriceString.split('e');
        const exponent = Math.abs(Number(rawExponent));
        const { tokenPriceBigInt, tokenPriceDecimals: baseDecimals } = convertTokenPriceToBigInt(Number(base));
        return {
            tokenPriceBigInt,
            tokenPriceDecimals: baseDecimals + exponent
        };
    }
    // Regular number handling
    const tokenPriceDecimals = tokenPriceString.split('.')[1]?.length || 0;
    const tokenPriceBigInt = (0, ethers_1.parseUnits)(tokenPriceString, tokenPriceDecimals);
    return { tokenPriceBigInt, tokenPriceDecimals };
};
exports.convertTokenPriceToBigInt = convertTokenPriceToBigInt;
const safeTokenAmountAndNumberMultiplication = (amount, decimals, tokenPrice) => {
    const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice);
    return (0, ethers_1.formatUnits)(amount * tokenPriceBigInt, 
    // Shift the decimal point by the number of decimals in the token price
    decimals + tokenPriceDecimals);
};
exports.safeTokenAmountAndNumberMultiplication = safeTokenAmountAndNumberMultiplication;
//# sourceMappingURL=formatters.js.map