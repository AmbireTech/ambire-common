"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFeeTokenForEstimate = getFeeTokenForEstimate;
exports.getSigForCalculations = getSigForCalculations;
const ethers_1 = require("ethers");
function getFeeTokenForEstimate(feeTokens) {
    if (!feeTokens.length)
        return null;
    const gasTankToken = feeTokens.find((feeToken) => feeToken.flags.onGasTank && feeToken.amount > 0n);
    const erc20token = feeTokens.find((feeToken) => feeToken.address !== ethers_1.ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n);
    const nativeToken = feeTokens.find((feeToken) => feeToken.address === ethers_1.ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n);
    // prioritize the gas tank token as it's the safest one
    // we do a transfer of the native so it's possible it reverts if we try
    // to do a max native transfer
    if (gasTankToken)
        return gasTankToken;
    if (erc20token)
        return erc20token;
    return nativeToken ?? null;
}
function getSigForCalculations() {
    return '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01';
}
//# sourceMappingURL=estimateHelpers.js.map