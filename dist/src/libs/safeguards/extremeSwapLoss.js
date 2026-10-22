"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSwapQuoteLossUsd = getSwapQuoteLossUsd;
exports.getSwapSlippageLossUsd = getSwapSlippageLossUsd;
exports.getSwapEstimatedLossUsd = getSwapEstimatedLossUsd;
exports.isExtremeSwapLoss = isExtremeSwapLoss;
exports.normalizeConfirmationPhraseInput = normalizeConfirmationPhraseInput;
exports.getRandomExtremeSwapConfirmationPhrase = getRandomExtremeSwapConfirmationPhrase;
const extremeSwapLoss_1 = require("../../consts/safeguards/extremeSwapLoss");
function getSwapQuoteLossUsd(inputValueInUsd, outputValueInUsd) {
    return Math.max(0, inputValueInUsd - outputValueInUsd);
}
function getSwapSlippageLossUsd(inputValueInUsd, minInUsd) {
    return Math.max(0, inputValueInUsd - minInUsd);
}
function getSwapEstimatedLossUsd(inputValueInUsd, outputValueInUsd, minInUsd) {
    return Math.max(getSwapQuoteLossUsd(inputValueInUsd, outputValueInUsd), getSwapSlippageLossUsd(inputValueInUsd, minInUsd));
}
function isExtremeSwapLoss(estimatedLossUsd) {
    return estimatedLossUsd > extremeSwapLoss_1.EXTREME_SWAP_LOSS_THRESHOLD_USD;
}
function normalizeConfirmationPhraseInput(phrase) {
    return phrase.trim().toUpperCase();
}
/** Picks one of the confirmation phrases the user has to type to confirm an extreme-loss swap. */
function getRandomExtremeSwapConfirmationPhrase() {
    const [firstPhrase] = extremeSwapLoss_1.EXTREME_SWAP_CONFIRMATION_PHRASES;
    const index = Math.floor(Math.random() * extremeSwapLoss_1.EXTREME_SWAP_CONFIRMATION_PHRASES.length);
    return extremeSwapLoss_1.EXTREME_SWAP_CONFIRMATION_PHRASES[index] ?? firstPhrase;
}
//# sourceMappingURL=extremeSwapLoss.js.map