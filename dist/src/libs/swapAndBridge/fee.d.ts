import type { TokenResult } from '../portfolio';
/**
 * The Swap & Bridge fee tiers, ordered by the minimum amount of stkWALLET held required to
 * unlock them. Shared between the fee calculation below and the UI (fee tier table, slider
 * threshold marks), so the two never drift apart.
 */
export declare const SWAP_AND_BRIDGE_FEE_TIERS: readonly [{
    readonly minStkWalletHeld: 0;
    readonly feePercent: 0.5;
}, {
    readonly minStkWalletHeld: 33000;
    readonly feePercent: 0.4;
}, {
    readonly minStkWalletHeld: 100000;
    readonly feePercent: 0.25;
}, {
    readonly minStkWalletHeld: 700000;
    readonly feePercent: 0;
}];
/**
 * The stkWALLET amounts at which the Swap & Bridge fee drops to the next tier, e.g. for marking
 * the corresponding thresholds on the WALLET staking amount slider.
 */
export declare const SWAP_AND_BRIDGE_FEE_THRESHOLDS: (0 | 100000 | 33000 | 700000)[];
/** Returns the Swap & Bridge fee percentage based on the amount of stkWALLET held. */
export declare const getFeePercent: (stkWalletHeld?: number) => number;
/**
 * Returns the 1-based Swap & Bridge fee tier index (e.g. 2 out of SWAP_AND_BRIDGE_FEE_TIERS.length)
 * for the amount of stkWALLET held, for display purposes (e.g. "tier 2 of 4").
 */
export declare const getFeeTier: (stkWalletHeld?: number) => number;
/**
 * Returns the Swap & Bridge fee percentage for a stkWALLET token, based on the confirmed
 * on-chain balance rather than any pending/simulated one - the fee is baked into the swap route
 * that gets signed and broadcast, so it must reflect only stkWALLET the account actually holds
 * right now, not a not-yet-settled balance that could still be reverted (e.g. a pending stake
 * that never confirms). Shared by SwapAndBridgeController and the UI so both stay in sync.
 */
export declare const getFeePercentForStkWalletToken: (stkWalletToken?: TokenResult) => number;
export type FeeExemptionReason = 'wrap-or-unwrap' | 'fee-exempt-token' | 'fee-collection-unavailable';
/** Returns why an operation is exempt from the Swap & Bridge fee, when applicable. */
export declare const getFeeExemptionReason: ({ isWrapOrUnwrap, isFeeExemptToken, isFeeCollectionAvailable }: {
    isWrapOrUnwrap: boolean;
    isFeeExemptToken: boolean;
    isFeeCollectionAvailable?: boolean;
}) => FeeExemptionReason | undefined;
//# sourceMappingURL=fee.d.ts.map