"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable class-methods-use-this */
const bundlers_1 = require("../../../consts/bundlers");
const types_1 = require("../types");
class PimlicoEstimationErrorHandler {
    matches(data, error) {
        const { bundlerName } = error;
        return bundlerName && bundlerName === bundlers_1.PIMLICO;
    }
    handle(data, error) {
        const { message } = error?.error || error || {};
        const lowerCased = message.toLowerCase();
        // TODO: expand with more error cases
        let reason = '';
        if (lowerCased.includes('internal error')) {
            reason = 'pimlico: 500';
        }
        return {
            type: types_1.ErrorType.BundlerError,
            reason,
            data: reason
        };
    }
}
exports.default = PimlicoEstimationErrorHandler;
//# sourceMappingURL=pimlico.js.map