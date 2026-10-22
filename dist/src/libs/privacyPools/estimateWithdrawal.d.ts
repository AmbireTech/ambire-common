import { RPCProvider } from '../../interfaces/provider';
/** The parts of the SDK's serialized userOp a simulation reads. Not exported by the SDK. */
export type PrivacyPoolsSerializedUserOperation = {
    sender: string;
    nonce: string;
    callData: string;
    callGasLimit: string;
    verificationGasLimit: string;
    preVerificationGas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    paymaster?: string;
    paymasterVerificationGasLimit?: string;
    paymasterPostOpGasLimit?: string;
    paymasterData?: string;
    signature: string;
    /** Signed by the single-use sender; `address` is the contract whose code it takes on. */
    eip7702Auth?: {
        address: string;
    };
};
/**
 * Thrown when the simulation ran and the withdrawal failed in it - unlike a node that could not
 * run it. A proof can go stale, e.g. once the association set's root moves on.
 */
export declare class PrivacyPoolsWithdrawalWouldFailError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** What running a prepared withdrawal showed it will cost. */
export type PrivacyPoolsWithdrawalFeeEstimate = {
    /** The fee locked into the proof minus what the paymaster refunds to the recipient. */
    expectedFee: bigint;
    /** The gas the userOp used, as the entry point reports it. */
    gasUsed: bigint;
    /** What that gas cost the paymaster, in wei. */
    gasCost: bigint;
};
/**
 * Estimates what a signed paymaster withdrawal will cost by simulating `EntryPoint.handleOps` on
 * the latest block, as the bundler will submit it.
 *
 * The proof's fee is a cap (all gas limits at the max gas price, plus a margin); the paymaster
 * refunds the unspent part to the recipient - a batch's too, as `readPaymasterWithdrawal` checks.
 *
 * A simulated call carries no 7702 authorization, so the sender's delegated code is set by a state
 * override; everything else is real on-chain state.
 *
 * Throws when the node cannot simulate it, or `PrivacyPoolsWithdrawalWouldFailError` when the
 * withdrawal would fail.
 */
export declare const estimatePaymasterWithdrawalFee: ({ provider, userOperation, entryPointAddress, paymasterAddress, recipient, tokenAddress, fee }: {
    provider: RPCProvider;
    userOperation: PrivacyPoolsSerializedUserOperation;
    entryPointAddress: string;
    paymasterAddress: string;
    recipient: string;
    /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
    tokenAddress: string;
    /** The fee locked into the proof, as `readPaymasterWithdrawal` decoded it. */
    fee: bigint;
}) => Promise<PrivacyPoolsWithdrawalFeeEstimate>;
//# sourceMappingURL=estimateWithdrawal.d.ts.map