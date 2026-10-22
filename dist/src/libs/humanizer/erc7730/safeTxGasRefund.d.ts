/** Details of a Safe transaction's additional gas-refund payment. */
export type SafeTxGasRefund = {
    refundReceiver?: string;
    gasToken: string;
    minAmount: bigint;
};
/**
 * Safe.sol's execTransaction only pays a gas refund at all when `gasPrice > 0` - see the
 * `if (gasPrice > 0) { payment = handlePayment(...) }` guard - independent of `baseGas`, which
 * only adds to the payment on top of the real (unknowable ahead of time) execution gas cost. Both
 * are static SafeTx/execTransaction fields, decodable without a relayer or ERC-7730 descriptor, so
 * this never depends on what fields an external descriptor declares - it works the same whether
 * the source is a signed SafeTx message or a broadcast execTransaction call.
 */
export declare const buildSafeTxGasRefund: (baseGas: unknown, gasPrice: unknown, gasToken: unknown, refundReceiver: unknown) => SafeTxGasRefund | null;
//# sourceMappingURL=safeTxGasRefund.d.ts.map