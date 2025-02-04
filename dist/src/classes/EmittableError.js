export default class EmittableError extends Error {
    level;
    message;
    error;
    constructor(errorRef) {
        super();
        this.message = errorRef.message;
        this.name = 'EmittableError';
        this.level = errorRef.level;
        if (!errorRef.error) {
            this.error = new Error(errorRef.message);
        }
        else {
            this.error = errorRef.error;
        }
    }
}
//# sourceMappingURL=EmittableError.js.map