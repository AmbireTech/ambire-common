"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ExternalSignerError extends Error {
    sendCrashReport;
    constructor(message, params) {
        super();
        const { sendCrashReport = false } = params || {};
        this.name = 'ExternalSignerError';
        this.message = message;
        // Don't send crash reports by default
        this.sendCrashReport = sendCrashReport;
    }
}
exports.default = ExternalSignerError;
//# sourceMappingURL=ExternalSignerError.js.map