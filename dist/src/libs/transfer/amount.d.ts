declare const getAmountAfterFeeReserve: (amount: bigint, fee: bigint) => bigint;
declare const getAmountAfterFeeSync: ({ currentAmount, totalAmount, fee, reservedFee, shouldReserveFee, isMaxAmountSelected }: {
    currentAmount: bigint;
    totalAmount: bigint;
    fee: bigint;
    reservedFee?: bigint;
    shouldReserveFee: boolean;
    isMaxAmountSelected: boolean;
}) => bigint;
/**
 * Removes any extra decimals from the amount.
 * @example getSanitizedAmount('1.123456', 2) => '1.12'
 */
declare const getSanitizedAmount: (amount: string, decimals: number) => string;
export { getAmountAfterFeeReserve, getAmountAfterFeeSync, getSanitizedAmount };
//# sourceMappingURL=amount.d.ts.map