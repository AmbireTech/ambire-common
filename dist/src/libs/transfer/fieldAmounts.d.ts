type AmountFieldMode = 'token' | 'fiat';
/**
 * Token and USD amounts of a Send amount field, typed in either. With no price, the input is the
 * token amount and there is no USD value. An empty input gives empty amounts.
 */
declare const getAmountsFromFieldValue: ({ fieldValue, fieldMode, price, decimals }: {
    fieldValue: string;
    fieldMode: AmountFieldMode;
    price: number | null;
    decimals: number;
}) => {
    amount: string;
    amountInFiat: string;
};
export type { AmountFieldMode };
export { getAmountsFromFieldValue };
//# sourceMappingURL=fieldAmounts.d.ts.map