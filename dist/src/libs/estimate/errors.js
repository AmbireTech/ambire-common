"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimationErrorFormatted = void 0;
function estimationErrorFormatted(error, opts) {
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
exports.estimationErrorFormatted = estimationErrorFormatted;
//# sourceMappingURL=errors.js.map