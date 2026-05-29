export default class ExternalSignerError extends Error {
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
//# sourceMappingURL=ExternalSignerError.js.map