"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFeeExemptionReason = exports.getFeePercentForStkWalletToken = exports.getFeeTier = exports.getFeePercent = exports.SWAP_AND_BRIDGE_FEE_THRESHOLDS = exports.SWAP_AND_BRIDGE_FEE_TIERS = void 0;
const ethers_1 = require("ethers");
const helpers_1 = require("../portfolio/helpers");
/**
 * The Swap & Bridge fee tiers, ordered by the minimum amount of stkWALLET held required to
 * unlock them. Shared between the fee calculation below and the UI (fee tier table, slider
 * threshold marks), so the two never drift apart.
 */
exports.SWAP_AND_BRIDGE_FEE_TIERS = [
    { minStkWalletHeld: 0, feePercent: 0.5 },
    { minStkWalletHeld: 33_000, feePercent: 0.4 },
    { minStkWalletHeld: 100_000, feePercent: 0.25 },
    { minStkWalletHeld: 700_000, feePercent: 0 }
];
/**
 * The stkWALLET amounts at which the Swap & Bridge fee drops to the next tier, e.g. for marking
 * the corresponding thresholds on the WALLET staking amount slider.
 */
exports.SWAP_AND_BRIDGE_FEE_THRESHOLDS = exports.SWAP_AND_BRIDGE_FEE_TIERS.slice(1).map((tier) => tier.minStkWalletHeld);
/** Returns the Swap & Bridge fee percentage based on the amount of stkWALLET held. */
const getFeePercent = (stkWalletHeld) => {
    const normalizedStkWalletHeld = typeof stkWalletHeld === 'number' && Number.isFinite(stkWalletHeld) ? stkWalletHeld : 0;
    return exports.SWAP_AND_BRIDGE_FEE_TIERS.reduce((feePercent, tier) => normalizedStkWalletHeld >= tier.minStkWalletHeld ? tier.feePercent : feePercent, exports.SWAP_AND_BRIDGE_FEE_TIERS[0].feePercent);
};
exports.getFeePercent = getFeePercent;
/**
 * Returns the 1-based Swap & Bridge fee tier index (e.g. 2 out of SWAP_AND_BRIDGE_FEE_TIERS.length)
 * for the amount of stkWALLET held, for display purposes (e.g. "tier 2 of 4").
 */
const getFeeTier = (stkWalletHeld) => {
    const normalizedStkWalletHeld = typeof stkWalletHeld === 'number' && Number.isFinite(stkWalletHeld) ? stkWalletHeld : 0;
    return exports.SWAP_AND_BRIDGE_FEE_TIERS.reduce((tierIndex, tier, index) => normalizedStkWalletHeld >= tier.minStkWalletHeld ? index + 1 : tierIndex, 1);
};
exports.getFeeTier = getFeeTier;
/**
 * Returns the Swap & Bridge fee percentage for a stkWALLET token, based on the confirmed
 * on-chain balance rather than any pending/simulated one - the fee is baked into the swap route
 * that gets signed and broadcast, so it must reflect only stkWALLET the account actually holds
 * right now, not a not-yet-settled balance that could still be reverted (e.g. a pending stake
 * that never confirms). Shared by SwapAndBridgeController and the UI so both stay in sync.
 */
const getFeePercentForStkWalletToken = (stkWalletToken) => (0, exports.getFeePercent)(stkWalletToken
    ? Number((0, ethers_1.formatUnits)((0, helpers_1.getTokenAmount)(stkWalletToken, true), stkWalletToken.decimals))
    : undefined);
exports.getFeePercentForStkWalletToken = getFeePercentForStkWalletToken;
/** Returns why an operation is exempt from the Swap & Bridge fee, when applicable. */
const getFeeExemptionReason = ({ isWrapOrUnwrap, isFeeExemptToken, isFeeCollectionAvailable = true }) => {
    if (isWrapOrUnwrap)
        return 'wrap-or-unwrap';
    if (isFeeExemptToken)
        return 'fee-exempt-token';
    if (!isFeeCollectionAvailable)
        return 'fee-collection-unavailable';
    return undefined;
};
exports.getFeeExemptionReason = getFeeExemptionReason;
//# sourceMappingURL=fee.js.map