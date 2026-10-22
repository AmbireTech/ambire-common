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
/**
 * Cuts a fiat amount down to the precision a currency field can display. The
 * number of decimals is taken from what `formatDecimals` shows for the same
 * amount.
 */
declare const truncateFiatAmountDecimals: (fiatAmount: string) => string;
declare const textToValidDecimal: (text: string) => string;
export { convertTokenPriceToBigInt, getSafeAmountFromFieldValue, safeTokenAmountAndNumberMultiplication, textToValidDecimal, truncateFiatAmountDecimals };
//# sourceMappingURL=formatters.d.ts.map