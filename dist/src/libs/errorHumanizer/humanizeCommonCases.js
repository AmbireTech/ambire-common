import { BROADCAST_OR_ESTIMATION_ERRORS } from './errors';
const humanizeEstimationOrBroadcastError = (reason, prefix) => {
    let message = null;
    if (!reason)
        return message;
    BROADCAST_OR_ESTIMATION_ERRORS.forEach((error) => {
        const isMatching = error.reasons.some((errorReason) => reason.toLowerCase().includes(errorReason.toLowerCase()));
        if (!isMatching)
            return;
        message = `${prefix !== '' ? `${prefix} ` : ''}${error.message}`;
    });
    return message;
};
export { humanizeEstimationOrBroadcastError };
//# sourceMappingURL=humanizeCommonCases.js.map