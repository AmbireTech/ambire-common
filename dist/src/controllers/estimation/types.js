"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EstimationFailureKind = exports.EstimationStatus = void 0;
var EstimationStatus;
(function (EstimationStatus) {
    EstimationStatus["Initial"] = "initial";
    EstimationStatus["Error"] = "error";
    EstimationStatus["Loading"] = "loading";
    EstimationStatus["Success"] = "success";
})(EstimationStatus || (exports.EstimationStatus = EstimationStatus = {}));
/** What asking again could do about the reason the last attempt failed. */
var EstimationFailureKind;
(function (EstimationFailureKind) {
    /**
     * Nothing was reached, but a later attempt may be. The reestimation loop
     * keeps going and the sign screen says it is taking longer than usual.
     */
    EstimationFailureKind["Retriable"] = "retriable";
    /** Asking again cannot change the outcome, so the loop stops. */
    EstimationFailureKind["Permanent"] = "permanent";
})(EstimationFailureKind || (exports.EstimationFailureKind = EstimationFailureKind = {}));
//# sourceMappingURL=types.js.map