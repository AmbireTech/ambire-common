/**
 * Converts floating point token price to big int
 */
declare const convertTokenPriceToBigInt: (tokenPrice: number) => {
    tokenPriceBigInt: bigint;
    tokenPriceDecimals: number;
};
declare const safeTokenAmountAndNumberMultiplication: (amount: bigint, decimals: number, tokenPrice: number) => string;
export { convertTokenPriceToBigInt, safeTokenAmountAndNumberMultiplication };
//# sourceMappingURL=formatters.d.ts.map