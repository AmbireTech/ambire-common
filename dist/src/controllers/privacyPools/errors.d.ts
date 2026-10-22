import EmittableError from '../../classes/EmittableError';
type DepositAsset = {
    decimals: number;
    symbol: string;
};
/**
 * The errors Privacy Pools actions throw, in one place so what the user reads can be reviewed
 * together. Every message must make sense to someone who knows nothing about how it works.
 */
export declare const privacyPoolsErrors: {
    noAccountSelected: () => EmittableError;
    noSupportedNetwork: () => EmittableError;
    locked: () => EmittableError;
    unavailableForAccount: () => EmittableError;
    seedRemoved: (seedId: string) => EmittableError;
    accountExists: (seedId: string) => EmittableError;
    depositAccountRemoved: (seedId: string) => EmittableError;
    depositLocked: () => EmittableError;
    depositUnsupportedNetwork: (chainId: string) => EmittableError;
    depositUnsupportedToken: (tokenAddress: string, chainId: string) => EmittableError;
    depositAboveMaximum: (maxDeposit: bigint, { decimals, symbol }: DepositAsset) => EmittableError;
    depositBelowMinimum: (minimumDeposit: bigint, { decimals, symbol }: DepositAsset) => EmittableError;
    depositUnsupportedPool: (symbol: string, poolAddress: string) => EmittableError;
    depositAwaitingChain: () => EmittableError;
    depositAssetConfigReadFailed: (cause: unknown) => EmittableError;
    depositPreparationFailed: (cause: unknown) => EmittableError;
    withdrawalUnsupportedNetwork: (chainId: string) => EmittableError;
    withdrawalUnsupportedToken: (symbol: string, poolAddress: string) => EmittableError;
    withdrawalBundlerOptedOut: () => EmittableError;
    withdrawalInvalidRecipient: () => EmittableError;
    withdrawalInFlight: () => EmittableError;
    withdrawalBatchNotSimulated: () => EmittableError;
    withdrawalFeeAboveAmount: (sdkError: Error) => EmittableError;
    withdrawalNotReady: () => EmittableError;
};
export {};
//# sourceMappingURL=errors.d.ts.map