"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanizeEstimationOrBroadcastError = void 0;
const errors_1 = require("./errors");
const helpers_1 = require("./helpers");
const humanizeEstimationOrBroadcastError = (reason, prefix, originalError) => {
    return (0, helpers_1.getHumanReadableErrorMessage)(null, errors_1.BROADCAST_OR_ESTIMATION_ERRORS, prefix, reason, originalError);
};
exports.humanizeEstimationOrBroadcastError = humanizeEstimationOrBroadcastError;
//# sourceMappingURL=humanizeCommonCases.js.map