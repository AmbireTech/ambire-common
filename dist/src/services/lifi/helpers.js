"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHumanReadableErrorMessage = void 0;
const consts_1 = require("./consts");
const getHumanReadableErrorMessage = (errorPrefix, error) => {
    // The code should be safe but we must ensure that humanizing errors
    // does not throw an error itself
    try {
        if (!error || typeof error !== 'object' || !('message' in error)) {
            return null;
        }
        const checkAgainst = error?.message;
        let message = null;
        if (checkAgainst && typeof checkAgainst === 'string') {
            consts_1.HUMANIZED_ERRORS.forEach((humanizedError) => {
                const { isExactMatch } = humanizedError;
                const isMatching = humanizedError.reasons.some((errorReason) => {
                    const lowerCaseReason = errorReason.toLowerCase();
                    const lowerCaseCheckAgainst = checkAgainst.toLowerCase();
                    if (isExactMatch) {
                        // Try a simple equality check first
                        if (lowerCaseCheckAgainst === lowerCaseReason)
                            return true;
                        // Split checkAgainst by spaces and check if any of the parts
                        // match the lowerCaseReason
                        const splitCheckAgainst = checkAgainst.split(' ');
                        return splitCheckAgainst.some((part) => part.toLowerCase() === lowerCaseReason);
                    }
                    return lowerCaseCheckAgainst.includes(lowerCaseReason);
                });
                if (!isMatching)
                    return;
                message = humanizedError.message;
            });
        }
        return message;
    }
    catch (e) {
        console.error('Error while getting human readable error message in lifi.ts:', e);
        return null;
    }
};
exports.getHumanReadableErrorMessage = getHumanReadableErrorMessage;
//# sourceMappingURL=helpers.js.map