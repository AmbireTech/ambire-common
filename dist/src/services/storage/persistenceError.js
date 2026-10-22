"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPersistenceError = toPersistenceError;
/**
 * Pairs the user-facing message with a real Error, synthesising one from `context` when
 * something non-Error was thrown, so Sentry always gets a stack.
 */
function toPersistenceError(message, error, context) {
    return { message, error: error instanceof Error ? error : new Error(context) };
}
//# sourceMappingURL=persistenceError.js.map