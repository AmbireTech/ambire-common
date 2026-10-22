"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.increaseFee = increaseFee;
exports.calculateFeeAmount = calculateFeeAmount;
const broadcast_1 = require("../broadcast/broadcast");
function increaseFee(amount, isAccountSafe, network) {
    if (isAccountSafe) {
        if (network.chainId === 1n)
            return amount + amount / 4n;
        return amount + amount / 2n;
    }
    return amount + amount / 10n;
}
function getAmountAfterFeeTokenConvert(simulatedGasLimit, gasPrice, nativeRatio, feeTokenDecimals, addedNative) {
    const amountInWei = simulatedGasLimit * gasPrice + addedNative;
    // Convert native gas cost to fee-token units, preserving 18 decimals of ratio precision.
    const extraDecimals = BigInt(10 ** 18);
    const feeTokenExtraDecimals = BigInt(10 ** (18 - feeTokenDecimals));
    const pow = extraDecimals * feeTokenExtraDecimals;
    const result = (amountInWei * nativeRatio) / pow;
    if (result === 0n && amountInWei !== 0n) {
        return 1n;
    }
    return result;
}
function calculateFeeAmount({ broadcastOption, simulatedGasLimit, gasPrice, nativeRatio, feeTokenDecimals, addedNative, usesPaymaster, isAccountSafe, network }) {
    if (broadcastOption === broadcast_1.BROADCAST_OPTIONS.bySelf ||
        broadcastOption === broadcast_1.BROADCAST_OPTIONS.bySelf7702 ||
        broadcastOption === broadcast_1.BROADCAST_OPTIONS.byOtherEOA) {
        return simulatedGasLimit * gasPrice + addedNative;
    }
    let amount = getAmountAfterFeeTokenConvert(simulatedGasLimit, gasPrice, nativeRatio, feeTokenDecimals, addedNative);
    if (broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler && usesPaymaster) {
        amount = increaseFee(amount, isAccountSafe, network);
    }
    return amount;
}
//# sourceMappingURL=fees.js.map