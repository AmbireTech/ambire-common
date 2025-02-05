"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable class-methods-use-this */
const constants_1 = require("../constants");
const types_1 = require("../types");
/** Handles custom errors thrown by contracts */
class CustomErrorHandler {
    matches(data) {
        return (!!data &&
            data !== '0x' &&
            !data?.startsWith(constants_1.ERROR_PREFIX) &&
            !data?.startsWith(constants_1.PANIC_ERROR_PREFIX));
    }
    handle(data) {
        return {
            type: types_1.ErrorType.CustomError,
            // Custom errors do not provide a specific reason.
            // Therefore, we return the raw data in hexadecimal format,
            // which can be used to map to a corresponding error message.
            reason: data,
            data
        };
    }
}
exports.default = CustomErrorHandler;
//# sourceMappingURL=custom.js.map