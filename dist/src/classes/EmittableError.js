"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class EmittableError extends Error {
    level;
    message;
    error;
    sendCrashReport;
    constructor(errorRef) {
        super();
        this.message = errorRef.message;
        this.name = 'EmittableError';
        this.level = errorRef.level;
        this.sendCrashReport = errorRef.sendCrashReport;
        if (!errorRef.error) {
            this.error = new Error(errorRef.message);
            Error.captureStackTrace(this.error, EmittableError);
        }
        else {
            this.error = errorRef.error;
        }
    }
}
exports.default = EmittableError;
//# sourceMappingURL=EmittableError.js.map