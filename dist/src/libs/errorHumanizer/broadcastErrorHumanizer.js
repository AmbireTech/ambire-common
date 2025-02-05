"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHumanReadableBroadcastError = exports.PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE = void 0;
const tslib_1 = require("tslib");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const ExternalSignerError_1 = tslib_1.__importDefault(require("../../classes/ExternalSignerError"));
const errorDecoder_1 = require("../errorDecoder");
const types_1 = require("../errorDecoder/types");
const errors_1 = require("./errors");
const helpers_1 = require("./helpers");
const humanizeCommonCases_1 = require("./humanizeCommonCases");
const LAST_RESORT_ERROR_MESSAGE = 'An unknown error occurred while broadcasting the transaction. Please try again or contact Ambire support for assistance.';
const MESSAGE_PREFIX = 'The transaction cannot be broadcast because';
exports.PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE = 'Currently, the paymaster seems to be down and your transaction cannot be broadcast. Please try again in a few moments or pay the fee with a Basic Account if the error persists';
function getPrefix(reason) {
    if (!reason)
        return MESSAGE_PREFIX;
    return !reason.includes('pimlico: 500') ? MESSAGE_PREFIX : '';
}
function getHumanReadableBroadcastError(e) {
    if (e instanceof EmittableError_1.default || e instanceof ExternalSignerError_1.default) {
        return e;
    }
    const decodedError = e instanceof Error ? (0, errorDecoder_1.decodeError)(e) : e;
    const commonError = (0, humanizeCommonCases_1.humanizeEstimationOrBroadcastError)(decodedError.reason, getPrefix(decodedError.reason));
    let errorMessage = (0, helpers_1.getHumanReadableErrorMessage)(commonError, errors_1.BROADCAST_ERRORS, MESSAGE_PREFIX, decodedError.reason, e);
    if (!errorMessage) {
        if (decodedError.type === types_1.ErrorType.PaymasterError) {
            errorMessage = exports.PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE;
        }
        else {
            errorMessage = (0, helpers_1.getGenericMessageFromType)(decodedError.type, decodedError.reason, MESSAGE_PREFIX, LAST_RESORT_ERROR_MESSAGE);
        }
    }
    return new Error(errorMessage, { cause: decodedError.reason });
}
exports.getHumanReadableBroadcastError = getHumanReadableBroadcastError;
//# sourceMappingURL=broadcastErrorHumanizer.js.map