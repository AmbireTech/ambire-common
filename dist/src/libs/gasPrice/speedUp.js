"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMinReplacementFees = getMinReplacementFees;
exports.getSpeedUpGasPrices = getSpeedUpGasPrices;
exports.getFeeIncreasePercent = getFeeIncreasePercent;
const ethers_1 = require("ethers");
// Nodes reject a transaction that replaces a pending one (same nonce) unless both its max fee
// and its tip are higher than the pending one's by a minimum percentage (10% on geth based
// nodes, 12.5% on some others). Using 12.5% satisfies all of them
const REPLACEMENT_FEE_INCREASE_BPS = 1250n;
/**
 * The lowest fees a transaction must pay to replace (speed up) a pending one
 * with the same nonce. Rounded up so the result never ends up just below the threshold.
 *
 * @param replacedFees - the fees of the pending transaction that is being replaced
 */
function getMinReplacementFees(replacedFees) {
    const increaseByReplacementBps = (value) => (value * (10000n + REPLACEMENT_FEE_INCREASE_BPS) + 9999n) / 10000n;
    return {
        maxFeePerGas: increaseByReplacementBps(replacedFees.gasPrice),
        maxPriorityFeePerGas: increaseByReplacementBps(replacedFees.maxPriorityFeePerGas ?? 0n)
    };
}
/**
 * Raises each speed's max fee and tip (separately) to at least the minimum needed to
 * replace (speed up) a pending transaction. Speeds that are already above it are kept as is.
 *
 * @param gasPrices - the current gas price estimation
 * @param replacedFees - the fees of the pending transaction that is being replaced
 */
function getSpeedUpGasPrices(gasPrices, replacedFees) {
    const minFees = getMinReplacementFees(replacedFees);
    const atLeast = (value, min) => {
        const bigValue = BigInt(value);
        return (0, ethers_1.toBeHex)(bigValue > min ? bigValue : min);
    };
    const raiseToMin = (gas) => ({
        maxFeePerGas: atLeast(gas.maxFeePerGas, minFees.maxFeePerGas),
        maxPriorityFeePerGas: atLeast(gas.maxPriorityFeePerGas, minFees.maxPriorityFeePerGas)
    });
    return {
        slow: raiseToMin(gasPrices.slow),
        medium: raiseToMin(gasPrices.medium),
        fast: raiseToMin(gasPrices.fast),
        ape: raiseToMin(gasPrices.ape)
    };
}
/**
 * How much more a replacement (speed up) pays than the transaction it replaces, in whole
 * percent. Null when it isn't higher (e.g. the replacement needs less gas) or the replaced fee
 * is 0. Both amounts must be in the same token
 */
function getFeeIncreasePercent(replacedAmount, newAmount) {
    if (replacedAmount <= 0n || newAmount <= replacedAmount)
        return null;
    return Math.round(Number(((newAmount - replacedAmount) * 10000n) / replacedAmount) / 100);
}
//# sourceMappingURL=speedUp.js.map