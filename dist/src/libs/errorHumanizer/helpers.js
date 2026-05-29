"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHumanReadableErrorMessage = void 0;
exports.getGenericMessageFromType = getGenericMessageFromType;
const helpers_1 = require("../errorDecoder/helpers");
const types_1 = require("../errorDecoder/types");
/**
 * If we fail to match the error reason to a human-readable error,
 * we return a generic message based on the error type.
 * This is a last resort to provide some context to the user.
 * The returned error message will contain the error reason if available
 */
function getGenericMessageFromType(errorType, reason, messagePrefix, lastResortMessage, originalError, 
// Whether to include the reason in the message. This is needed
// for estimation errors where the reason is displayed separately
// and we don't want to repeat it in the message.
withReason = true) {
    const messageSuffixNoSupport = withReason
        ? (0, helpers_1.getErrorCodeStringFromReason)(reason || originalError?.message || originalError?.error?.message || '')
        : '';
    const messageSuffix = `${messageSuffixNoSupport}\nPlease try again or contact Ambire support for assistance.`;
    const origin = errorType?.split('Error')?.[0] || '';
    switch (errorType) {
        case types_1.ErrorType.RelayerError:
        case types_1.ErrorType.RpcError:
            return `${messagePrefix} of an unknown error (Origin: ${origin} call).${messageSuffix}`;
        case types_1.ErrorType.PaymasterError:
            return `${messagePrefix} of a Paymaster Error.${messageSuffix}`;
        case types_1.ErrorType.BundlerError:
            return `${messagePrefix} it's invalid.${messageSuffixNoSupport}`;
        case types_1.ErrorType.CodeError:
            return `${messagePrefix} of an unknown error.${messageSuffix}`;
        case types_1.ErrorType.UnknownError: {
            if (messageSuffixNoSupport) {
                return `We encountered an unexpected issue:${messageSuffix.replace('Error code: ', '')}`;
            }
            return `${messagePrefix} of an unknown error.${messageSuffix}`;
        }
        case types_1.ErrorType.InnerCallFailureError:
            if (reason === 'OOG')
                return 'Transaction invalid: out of gas';
            return (0, helpers_1.isReasonValid)(reason)
                ? `${messagePrefix} it will revert onchain.${messageSuffixNoSupport}`
                : `${messagePrefix} it will revert onchain with reason unknown.${messageSuffix}`;
        // I don't think we should say anything else for this case
        case types_1.ErrorType.UserRejectionError:
            return 'Transaction rejected.';
        // Panic error may scare the user so let's call it a contract error
        case types_1.ErrorType.CustomError:
        case types_1.ErrorType.PanicError:
        case types_1.ErrorType.RevertError:
            return `${messagePrefix} of a contract error.${messageSuffixNoSupport}`;
        default:
            return lastResortMessage;
    }
}
/**
 * The relayer may return an error that is already ready to be displayed to the user.
 * Note: As the relayer is called directly and used as a paymaster
 */
function getHumanizedRelayerError(decodedError, originalError) {
    if (decodedError.type !== types_1.ErrorType.RelayerError &&
        decodedError.type !== types_1.ErrorType.PaymasterError)
        return null;
    if (!originalError.isHumanized)
        return null;
    return originalError.message;
}
/**
 * A function that takes information about an error and attempts to return a human-readable error message by
 * matching the error reason against a list of known errors.
 */
const getHumanReadableErrorMessage = (commonError, errors, messagePrefix, decodedError, e) => {
    if (commonError)
        return commonError;
    const alreadyHumanizedError = getHumanizedRelayerError(decodedError, e);
    if (alreadyHumanizedError)
        return alreadyHumanizedError;
    const { reason } = decodedError;
    const checkAgainst = reason || e?.error?.message || e?.message;
    let message = null;
    if (checkAgainst && typeof checkAgainst === 'string') {
        errors.forEach((error) => {
            const { isExactMatch } = error;
            const isMatching = error.reasons.some((errorReason) => {
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
            message = `${messagePrefix ? `${messagePrefix} ` : ''}${error.message}`;
        });
    }
    return message;
};
exports.getHumanReadableErrorMessage = getHumanReadableErrorMessage;
//# sourceMappingURL=helpers.js.map