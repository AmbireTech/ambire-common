"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSACTION_REJECTED_REASON = exports.USER_REJECTED_TRANSACTION_ERROR_CODE = void 0;
/* eslint-disable class-methods-use-this */
const types_1 = require("../types");
exports.USER_REJECTED_TRANSACTION_ERROR_CODE = 4001;
exports.TRANSACTION_REJECTED_REASON = 'transaction-rejected';
class UserRejectionHandler {
    matches(data, error) {
        return (!data &&
            (error?.message?.includes('rejected transaction') ||
                error?.code === exports.USER_REJECTED_TRANSACTION_ERROR_CODE));
    }
    handle(data) {
        return {
            type: types_1.ErrorType.UserRejectionError,
            reason: exports.TRANSACTION_REJECTED_REASON,
            data
        };
    }
}
exports.default = UserRejectionHandler;
//# sourceMappingURL=userRejection.js.map