"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_PREFIX = void 0;
exports.getHumanReadableEstimationError = getHumanReadableEstimationError;
const tslib_1 = require("tslib");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const ErrorHumanizerError_1 = tslib_1.__importDefault(require("../../classes/ErrorHumanizerError"));
const ExternalSignerError_1 = tslib_1.__importDefault(require("../../classes/ExternalSignerError"));
const errorDecoder_1 = require("../errorDecoder");
const errors_1 = require("./errors");
const helpers_1 = require("./helpers");
const humanizeCommonCases_1 = require("./humanizeCommonCases");
exports.MESSAGE_PREFIX = 'Transaction cannot be sent because';
const LAST_RESORT_ERROR_MESSAGE = 'Transaction cannot be sent because of an unknown error. Please try again or contact Ambire support for assistance.';
function getPrefix(reason) {
    if (!reason)
        return exports.MESSAGE_PREFIX;
    return !reason.includes('pimlico: 500') ? exports.MESSAGE_PREFIX : '';
}
function getHumanReadableEstimationError(e) {
    // These errors should be thrown as they are
    // as they are already human-readable
    if (e instanceof EmittableError_1.default || e instanceof ExternalSignerError_1.default) {
        return new ErrorHumanizerError_1.default(e.message, {
            cause: typeof e.cause === 'string' ? e.cause : null,
            isFallbackMessage: false
        });
    }
    let isFallbackMessage = false;
    const decodedError = e instanceof Error ? (0, errorDecoder_1.decodeError)(e) : e;
    const commonError = (0, humanizeCommonCases_1.humanizeEstimationOrBroadcastError)(decodedError.reason, getPrefix(decodedError.reason), e);
    let errorMessage = (0, helpers_1.getHumanReadableErrorMessage)(commonError, errors_1.ESTIMATION_ERRORS, exports.MESSAGE_PREFIX, decodedError.reason, e);
    if (!errorMessage) {
        isFallbackMessage = true;
        errorMessage = (0, helpers_1.getGenericMessageFromType)(decodedError.type, decodedError.reason, exports.MESSAGE_PREFIX, LAST_RESORT_ERROR_MESSAGE, false);
    }
    return new ErrorHumanizerError_1.default(errorMessage, {
        cause: decodedError.reason,
        isFallbackMessage
    });
}
//# sourceMappingURL=estimationErrorHumanizer.js.map