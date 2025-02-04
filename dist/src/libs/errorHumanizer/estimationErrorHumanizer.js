import EmittableError from '../../classes/EmittableError';
import ExternalSignerError from '../../classes/ExternalSignerError';
import { decodeError } from '../errorDecoder';
import { ESTIMATION_ERRORS } from './errors';
import { getGenericMessageFromType, getHumanReadableErrorMessage } from './helpers';
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases';
export const MESSAGE_PREFIX = 'The transaction will fail because';
const LAST_RESORT_ERROR_MESSAGE = 'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.';
function getPrefix(reason) {
    if (!reason)
        return MESSAGE_PREFIX;
    return !reason.includes('pimlico: 500') ? MESSAGE_PREFIX : '';
}
export function getHumanReadableEstimationError(e) {
    // These errors should be thrown as they are
    // as they are already human-readable
    if (e instanceof EmittableError || e instanceof ExternalSignerError) {
        return e;
    }
    const decodedError = e instanceof Error ? decodeError(e) : e;
    const commonError = humanizeEstimationOrBroadcastError(decodedError.reason, getPrefix(decodedError.reason));
    let errorMessage = getHumanReadableErrorMessage(commonError, ESTIMATION_ERRORS, MESSAGE_PREFIX, decodedError.reason, e);
    if (!errorMessage) {
        errorMessage = getGenericMessageFromType(decodedError.type, decodedError.reason, MESSAGE_PREFIX, LAST_RESORT_ERROR_MESSAGE);
    }
    return new Error(errorMessage, { cause: decodedError.reason });
}
//# sourceMappingURL=estimationErrorHumanizer.js.map