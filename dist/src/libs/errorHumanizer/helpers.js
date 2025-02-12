"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHumanReadableErrorMessage = exports.getGenericMessageFromType = void 0;
const helpers_1 = require("../errorDecoder/helpers");
const types_1 = require("../errorDecoder/types");
function getGenericMessageFromType(errorType, reason, messagePrefix, lastResortMessage) {
    const reasonString = (0, helpers_1.getErrorCodeStringFromReason)(reason ?? '');
    const messageSuffixNoSupport = `${reasonString}\n`;
    const messageSuffix = `${messageSuffixNoSupport}Please try again or contact Ambire support for assistance.`;
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
        case types_1.ErrorType.UnknownError:
            return `${messagePrefix} of an unknown error.${messageSuffix}`;
        case types_1.ErrorType.InnerCallFailureError:
            return reasonString
                ? `${messagePrefix} it will revert onchain.${messageSuffixNoSupport}`
                : `${messagePrefix} it will revert onchain with reason unknown.${messageSuffix}`;
        // I don't think we should say anything else for this case
        case types_1.ErrorType.UserRejectionError:
            return 'Transaction rejected.';
        // Panic error may scare the user so let's call it a contract error
        case types_1.ErrorType.CustomError:
        case types_1.ErrorType.PanicError:
        case types_1.ErrorType.RevertError:
            return `${messagePrefix} of a contract error.${messageSuffix}`;
        default:
            return lastResortMessage;
    }
}
exports.getGenericMessageFromType = getGenericMessageFromType;
const getHumanReadableErrorMessage = (commonError, errors, messagePrefix, reason, e) => {
    if (commonError)
        return commonError;
    const checkAgainst = reason || e?.error?.message || e?.message;
    let message = null;
    if (checkAgainst) {
        errors.forEach((error) => {
            const isMatching = error.reasons.some((errorReason) => checkAgainst.toLowerCase().includes(errorReason.toLowerCase()));
            if (!isMatching)
                return;
            message = `${messagePrefix} ${error.message}`;
        });
    }
    return message;
};
exports.getHumanReadableErrorMessage = getHumanReadableErrorMessage;
//# sourceMappingURL=helpers.js.map