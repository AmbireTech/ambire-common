import { PrivacyPoolsPaymasterConfig } from '../../interfaces/privacyPools';
/** The parts of the SDK's `IGenericPaymasterWithdrawalPayload` read here (not exported). */
export type PrivacyPoolsPaymasterWithdrawalPayload = {
    /** The SDK stores addresses as bigints. */
    poolAddress: bigint;
    paymasterAddress: string;
    entryPointAddress: string;
    userOperation: {
        sender: string;
        callData: string;
        paymaster?: string;
        paymasterData?: string;
    };
};
/**
 * What a prepared paymaster withdrawal does, read from the bytes the paymaster and pool act on, so
 * it can be shown as what will happen rather than as what was asked for.
 */
export type PrivacyPoolsPaymasterWithdrawal = {
    /** Who receives the funds. */
    recipient: string;
    /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
    tokenAddress: string;
    /** What leaves the Privacy Pools account, before the fee. */
    amount: bigint;
    /** The cap locked into the proof, taken out of `amount`. */
    fee: bigint;
    /** How many deposits the withdrawal spends. */
    noteCount: number;
};
/**
 * Decodes a prepared paymaster withdrawal and checks it against the request, returning what it
 * does - to show it from the payload rather than from the request.
 *
 * Security boundary: the SDK builds and signs the userOp in one call, so this is the one
 * place to verify, from the bytes the paymaster and pool act on, the token, the recipient, the
 * amount, the fee recipient and the refund recipient. Any mismatch is refused before the user is
 * asked to send it.
 *
 * A single deposit is paid straight to the recipient with no calls; a batch goes through the
 * single-use sender - see `readBatchCalls`.
 */
export declare const readPaymasterWithdrawal: ({ withdrawal, paymaster, poolAddress: tokenPoolAddress, recipient, tokenAddress, amount }: {
    withdrawal: PrivacyPoolsPaymasterWithdrawalPayload;
    paymaster: PrivacyPoolsPaymasterConfig;
    /**
     * The token's pool, as the entrypoint lists it. The payload names only a pool, and every pool has
     * an adapter, so this is what ties the withdrawal to the token.
     */
    poolAddress: string;
    recipient: string;
    /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
    tokenAddress: string;
    amount: bigint;
}) => PrivacyPoolsPaymasterWithdrawal;
//# sourceMappingURL=paymasterWithdrawal.d.ts.map