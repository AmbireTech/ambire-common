"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPrivacyPoolsSdkError = void 0;
/**
 * Turns whatever the Privacy Pools SDK threw into an `Error`, keeping its message and the original
 * as `cause`. The SDK's Redux Toolkit thunks rethrow plain `{ name, message, stack }` objects.
 */
const toPrivacyPoolsSdkError = (error, fallbackMessage) => {
    if (error instanceof Error)
        return error;
    const message = typeof error === 'object' && error !== null && 'message' in error
        ? error.message
        : undefined;
    if (typeof message !== 'string' || !message)
        return new Error(fallbackMessage, { cause: error });
    const normalized = new Error(message, { cause: error });
    const { name, stack } = error;
    if (typeof name === 'string' && name)
        normalized.name = name;
    if (typeof stack === 'string' && stack)
        normalized.stack = stack;
    return normalized;
};
exports.toPrivacyPoolsSdkError = toPrivacyPoolsSdkError;
//# sourceMappingURL=sdkError.js.map