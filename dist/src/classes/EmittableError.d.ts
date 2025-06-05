import { ErrorRef } from '../controllers/eventEmitter/eventEmitter';
export default class EmittableError extends Error {
    level: ErrorRef['level'];
    message: ErrorRef['message'];
    error: Error;
    constructor(errorRef: {
        message: ErrorRef['message'];
        level: ErrorRef['level'];
        error?: Error;
    });
}
//# sourceMappingURL=EmittableError.d.ts.map