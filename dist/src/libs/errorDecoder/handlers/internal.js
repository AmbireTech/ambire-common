"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable class-methods-use-this */
const types_1 = require("../types");
const CONNECTIVITY_REASONS = ['Failed to fetch', 'NetworkError', 'Failed to load'];
class InternalHandler {
    matches(data, error) {
        return (error instanceof TypeError ||
            error instanceof ReferenceError ||
            error instanceof SyntaxError ||
            error instanceof RangeError);
    }
    handle(data, error) {
        const isConnectivityError = CONNECTIVITY_REASONS.some((reason) => error.message?.includes(reason));
        if (isConnectivityError) {
            return {
                type: types_1.ErrorType.ConnectivityError,
                reason: 'ConnectivityError',
                data: error.message
            };
        }
        return {
            type: types_1.ErrorType.CodeError,
            reason: error.name,
            data
        };
    }
}
exports.default = InternalHandler;
//# sourceMappingURL=internal.js.map