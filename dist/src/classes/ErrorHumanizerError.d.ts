export default class ErrorHumanizerError extends Error {
    isFallbackMessage: boolean;
    constructor(message: string, { cause, isFallbackMessage }: {
        cause?: string | null;
        isFallbackMessage?: boolean;
    });
}
//# sourceMappingURL=ErrorHumanizerError.d.ts.map