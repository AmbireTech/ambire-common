export function estimationErrorFormatted(error, opts) {
    const feePaymentOptions = opts?.feePaymentOptions ?? [];
    const finalsOps = {
        ...opts,
        feePaymentOptions,
        nonFatalErrors: opts?.nonFatalErrors ?? undefined
    };
    return {
        gasUsed: 0n,
        currentAccountNonce: 0,
        error,
        ...finalsOps
    };
}
//# sourceMappingURL=errors.js.map