"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSafeTxGasRefund = void 0;
const ethers_1 = require("ethers");
const toBigIntOrNull = (value) => {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'number' || typeof value === 'string') {
        try {
            return BigInt(value);
        }
        catch {
            return null;
        }
    }
    return null;
};
/**
 * Safe.sol's execTransaction only pays a gas refund at all when `gasPrice > 0` - see the
 * `if (gasPrice > 0) { payment = handlePayment(...) }` guard - independent of `baseGas`, which
 * only adds to the payment on top of the real (unknowable ahead of time) execution gas cost. Both
 * are static SafeTx/execTransaction fields, decodable without a relayer or ERC-7730 descriptor, so
 * this never depends on what fields an external descriptor declares - it works the same whether
 * the source is a signed SafeTx message or a broadcast execTransaction call.
 */
const buildSafeTxGasRefund = (baseGas, gasPrice, gasToken, refundReceiver) => {
    const bigintBaseGas = toBigIntOrNull(baseGas ?? 0);
    const bigintGasPrice = toBigIntOrNull(gasPrice ?? 0);
    if (bigintBaseGas === null || bigintGasPrice === null || bigintGasPrice <= 0n)
        return null;
    const receiver = typeof refundReceiver === 'string' && (0, ethers_1.isAddress)(refundReceiver)
        ? (0, ethers_1.getAddress)(refundReceiver)
        : null;
    return {
        refundReceiver: receiver && receiver !== ethers_1.ZeroAddress ? receiver : undefined,
        gasToken: typeof gasToken === 'string' && (0, ethers_1.isAddress)(gasToken) ? (0, ethers_1.getAddress)(gasToken) : ethers_1.ZeroAddress,
        minAmount: bigintBaseGas * bigintGasPrice
    };
};
exports.buildSafeTxGasRefund = buildSafeTxGasRefund;
//# sourceMappingURL=safeTxGasRefund.js.map