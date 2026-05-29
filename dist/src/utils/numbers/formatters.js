import { formatUnits, parseUnits } from 'ethers';
import { getSanitizedAmount } from '../../libs/transfer/amount';
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
/**
 * Sanitizes the amount by removing values outside of the token's decimal range.
 * Also formats `.`, `.${number}` and `${number}.` to `0.0`, `0.${number}` and `${number}.0` respectively
 */
const getSafeAmountFromFieldValue = (fieldValue, tokenDecimals) => {
    let parsedFieldValue = fieldValue.trim();
    if (fieldValue.startsWith('.')) {
        // If the amount starts with a dot, prepend a zero
        parsedFieldValue = `0${parsedFieldValue}`;
    }
    if (fieldValue.endsWith('.')) {
        // If the amount ends with a dot, append a zero
        parsedFieldValue = `${parsedFieldValue}0`;
    }
    // Don't sanitize the amount if there is no selected token
    if (!tokenDecimals)
        return parsedFieldValue;
    return getSanitizedAmount(parsedFieldValue, tokenDecimals);
};
const textToValidDecimal = (text) => {
    let formatted = text;
    // Remove invalid chars (only digits and dots allowed)
    formatted = formatted.replace(/[^0-9.]/g, '');
    // If input starts with ".", prefix with "0"
    if (formatted.startsWith('.')) {
        formatted = `0${formatted}`;
    }
    // Prevent multiple decimals
    const parts = formatted.split('.');
    if (parts.length > 2) {
        formatted = `${parts[0]}.${parts.slice(1).join('')}`;
    }
    formatted = formatted.replace(/^0+(?=\d)/, '');
    if (formatted === '')
        formatted = '0';
    return formatted;
};
export { convertTokenPriceToBigInt, getSafeAmountFromFieldValue, safeTokenAmountAndNumberMultiplication, textToValidDecimal };
//# sourceMappingURL=formatters.js.map