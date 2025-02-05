"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ExternalSignerError extends Error {
    constructor(message) {
        super();
        this.name = 'ExternalSignerError';
        this.message = message;
    }
}
exports.default = ExternalSignerError;
//# sourceMappingURL=ExternalSignerError.js.map