/**
 * Converts floating point token price to big int
 */
declare const convertTokenPriceToBigInt: (tokenPrice: number) => {
    tokenPriceBigInt: bigint;
    tokenPriceDecimals: number;
};
declare const safeTokenAmountAndNumberMultiplication: (amount: bigint, decimals: number, tokenPrice: number) => string;
/**
 * Sanitizes the amount by removing values outside of the token's decimal range.
 * Also formats `.`, `.${number}` and `${number}.` to `0.0`, `0.${number}` and `${number}.0` respectively
 */
declare const getSafeAmountFromFieldValue: (fieldValue: string, tokenDecimals?: number) => string;
declare const textToValidDecimal: (text: string) => string;
export { convertTokenPriceToBigInt, getSafeAmountFromFieldValue, safeTokenAmountAndNumberMultiplication, textToValidDecimal };
//# sourceMappingURL=formatters.d.ts.map