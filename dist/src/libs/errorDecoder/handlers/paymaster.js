"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable class-methods-use-this */
const types_1 = require("../types");
class PaymasterErrorHandler {
    matches(data, error) {
        const { name } = error;
        return name === 'PaymasterError' || name === 'PaymasterSponsorshipError';
    }
    handle(data, error) {
        const { message: reason } = error;
        return {
            type: types_1.ErrorType.PaymasterError,
            reason,
            data: ''
        };
    }
}
exports.default = PaymasterErrorHandler;
//# sourceMappingURL=paymaster.js.map