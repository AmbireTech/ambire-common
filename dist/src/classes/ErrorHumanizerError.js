"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ErrorHumanizerError extends Error {
    isFallbackMessage;
    constructor(message, { cause, isFallbackMessage }) {
        super(message);
        this.name = 'ErrorHumanizerError';
        this.isFallbackMessage = !!isFallbackMessage;
        this.cause = cause;
    }
}
exports.default = ErrorHumanizerError;
//# sourceMappingURL=ErrorHumanizerError.js.map