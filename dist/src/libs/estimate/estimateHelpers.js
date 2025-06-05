"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFeeTokenForEstimate = getFeeTokenForEstimate;
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
//# sourceMappingURL=estimateHelpers.js.map