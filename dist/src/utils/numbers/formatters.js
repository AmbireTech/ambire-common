import { formatUnits, parseUnits } from 'ethers';
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
    const tokenPriceBigInt = parseUnits(tokenPriceString, tokenPriceDecimals);
    return { tokenPriceBigInt, tokenPriceDecimals };
};
const safeTokenAmountAndNumberMultiplication = (amount, decimals, tokenPrice) => {
    const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice);
    return formatUnits(amount * tokenPriceBigInt, 
    // Shift the decimal point by the number of decimals in the token price
    decimals + tokenPriceDecimals);
};
export { convertTokenPriceToBigInt, safeTokenAmountAndNumberMultiplication };
//# sourceMappingURL=formatters.js.map