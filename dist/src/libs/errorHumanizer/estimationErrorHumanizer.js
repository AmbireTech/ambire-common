"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHumanReadableEstimationError = exports.MESSAGE_PREFIX = void 0;
const tslib_1 = require("tslib");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const ExternalSignerError_1 = tslib_1.__importDefault(require("../../classes/ExternalSignerError"));
const errorDecoder_1 = require("../errorDecoder");
const errors_1 = require("./errors");
const helpers_1 = require("./helpers");
const humanizeCommonCases_1 = require("./humanizeCommonCases");
exports.MESSAGE_PREFIX = 'The transaction will fail because';
const LAST_RESORT_ERROR_MESSAGE = 'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.';
function getPrefix(reason) {
    if (!reason)
        return exports.MESSAGE_PREFIX;
    return !reason.includes('pimlico: 500') ? exports.MESSAGE_PREFIX : '';
}
function getHumanReadableEstimationError(e) {
    // These errors should be thrown as they are
    // as they are already human-readable
    if (e instanceof EmittableError_1.default || e instanceof ExternalSignerError_1.default) {
        return e;
    }
    const decodedError = e instanceof Error ? (0, errorDecoder_1.decodeError)(e) : e;
    const commonError = (0, humanizeCommonCases_1.humanizeEstimationOrBroadcastError)(decodedError.reason, getPrefix(decodedError.reason));
    let errorMessage = (0, helpers_1.getHumanReadableErrorMessage)(commonError, errors_1.ESTIMATION_ERRORS, exports.MESSAGE_PREFIX, decodedError.reason, e);
    if (!errorMessage) {
        errorMessage = (0, helpers_1.getGenericMessageFromType)(decodedError.type, decodedError.reason, exports.MESSAGE_PREFIX, LAST_RESORT_ERROR_MESSAGE);
    }
    return new Error(errorMessage, { cause: decodedError.reason });
}
exports.getHumanReadableEstimationError = getHumanReadableEstimationError;
//# sourceMappingURL=estimationErrorHumanizer.js.map