import { ErrorRef } from '../interfaces/eventEmitter';
export default class EmittableError extends Error {
    level: ErrorRef['level'];
    message: ErrorRef['message'];
    error: ErrorRef['error'];
    sendCrashReport?: ErrorRef['sendCrashReport'];
    constructor(errorRef: {
        message: ErrorRef['message'];
        level: ErrorRef['level'];
        error?: ErrorRef['error'];
        sendCrashReport?: ErrorRef['sendCrashReport'];
    });
}
//# sourceMappingURL=EmittableError.d.ts.map