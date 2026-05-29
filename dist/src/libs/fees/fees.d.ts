export type FeeBroadcaster = 'paymaster' | 'relayer';
export declare function increaseFee(amount: bigint, broadcaster?: FeeBroadcaster): bigint;
export declare function calculateFeeAmount({ broadcastOption, simulatedGasLimit, gasPrice, nativeRatio, feeTokenDecimals, addedNative, usesPaymaster }: {
    broadcastOption: string;
    simulatedGasLimit: bigint;
    gasPrice: bigint;
    nativeRatio: bigint;
    feeTokenDecimals: number;
    addedNative: bigint;
    usesPaymaster?: boolean;
}): bigint;
//# sourceMappingURL=fees.d.ts.map