import { ErrorRef } from '../interfaces/eventEmitter';
export default class ExternalSignerError extends Error {
    sendCrashReport?: ErrorRef['sendCrashReport'];
    constructor(message: string, params?: {
        sendCrashReport?: ErrorRef['sendCrashReport'];
    });
}
//# sourceMappingURL=ExternalSignerError.d.ts.map