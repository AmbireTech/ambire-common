export default class ErrorHumanizerError extends Error {
    isFallbackMessage;
    constructor(message, { cause, isFallbackMessage }) {
        super(message);
        this.name = 'ErrorHumanizerError';
        this.isFallbackMessage = !!isFallbackMessage;
        this.cause = cause;
    }
}
//# sourceMappingURL=ErrorHumanizerError.js.map