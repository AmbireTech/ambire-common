import { BROADCAST_OR_ESTIMATION_ERRORS } from './errors';
import { getHumanReadableErrorMessage } from './helpers';
const humanizeEstimationOrBroadcastError = (decodedError, prefix, originalError) => {
    return getHumanReadableErrorMessage(null, BROADCAST_OR_ESTIMATION_ERRORS, prefix, decodedError, originalError);
};
export { humanizeEstimationOrBroadcastError };
//# sourceMappingURL=humanizeCommonCases.js.map