import type { Network } from '../../interfaces/network';
type FeeNetwork = Pick<Network, 'chainId'>;
export declare function increaseFee(amount: bigint, isAccountSafe: boolean, network: FeeNetwork): bigint;
export declare function calculateFeeAmount({ broadcastOption, simulatedGasLimit, gasPrice, nativeRatio, feeTokenDecimals, addedNative, usesPaymaster, isAccountSafe, network }: {
    broadcastOption: string;
    simulatedGasLimit: bigint;
    gasPrice: bigint;
    nativeRatio: bigint;
    feeTokenDecimals: number;
    addedNative: bigint;
    usesPaymaster?: boolean;
    isAccountSafe: boolean;
    network: FeeNetwork;
}): bigint;
export {};
//# sourceMappingURL=fees.d.ts.map