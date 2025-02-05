"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFeeTokenForEstimate = void 0;
const ethers_1 = require("ethers");
function getFeeTokenForEstimate(feeTokens, network) {
    if (!feeTokens.length)
        return null;
    const gasTankToken = feeTokens.find((feeToken) => feeToken.flags.onGasTank && feeToken.amount > 0n);
    const erc20token = feeTokens.find((feeToken) => feeToken.address !== ethers_1.ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n);
    const nativeToken = feeTokens.find((feeToken) => feeToken.address === ethers_1.ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n);
    // for optimistic L2s, prioritize the gas tank token as a fee payment
    // option as its callData costs more than the actual transfer of tokens
    if (network.isOptimistic) {
        if (gasTankToken)
            return gasTankToken;
        if (erc20token)
            return erc20token;
        return nativeToken ?? null;
    }
    // for L1s, prioritize erc20 transfer as it's the most expensive
    if (erc20token)
        return erc20token;
    if (nativeToken)
        return nativeToken;
    return gasTankToken ?? null;
}
exports.getFeeTokenForEstimate = getFeeTokenForEstimate;
//# sourceMappingURL=estimateHelpers.js.map