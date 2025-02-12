"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanizeEstimationOrBroadcastError = void 0;
const errors_1 = require("./errors");
const humanizeEstimationOrBroadcastError = (reason, prefix) => {
    let message = null;
    if (!reason)
        return message;
    errors_1.BROADCAST_OR_ESTIMATION_ERRORS.forEach((error) => {
        const isMatching = error.reasons.some((errorReason) => reason.toLowerCase().includes(errorReason.toLowerCase()));
        if (!isMatching)
            return;
        message = `${prefix !== '' ? `${prefix} ` : ''}${error.message}`;
    });
    return message;
};
exports.humanizeEstimationOrBroadcastError = humanizeEstimationOrBroadcastError;
//# sourceMappingURL=humanizeCommonCases.js.map