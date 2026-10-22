"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXTREME_SWAP_CONFIRMATION_PHRASES = exports.SLIPPAGE_MIN_QUOTE_DIFF_USD = exports.HIGH_PRICE_IMPACT_PERCENT_THRESHOLD = exports.EXTREME_SWAP_LOSS_THRESHOLD_USD = void 0;
exports.EXTREME_SWAP_LOSS_THRESHOLD_USD = 1_000;
exports.HIGH_PRICE_IMPACT_PERCENT_THRESHOLD = 5;
exports.SLIPPAGE_MIN_QUOTE_DIFF_USD = 50;
// The phrases the user must type to confirm an extreme-loss swap. One of them is
// picked at random every time the warning shows up, so the confirmation can't be
// typed out of muscle memory.
exports.EXTREME_SWAP_CONFIRMATION_PHRASES = [
    "I'LL LOSE MONEY",
    'BAD IDEA',
    'I CHOOSE CHAOS',
    'THIS WILL HURT'
];
//# sourceMappingURL=extremeSwapLoss.js.map