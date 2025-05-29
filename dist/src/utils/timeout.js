"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRecurringTimeout = createRecurringTimeout;
// Execute `fn` at a specific interval, ensuring that the current invocation of `fn`
// completes before the next one starts. This serves as an alternative to `setInterval`,
// but providing protection against overlapping invocations of `fn`.
function createRecurringTimeout(fn, timeout) {
    let timeoutId;
    const stop = () => {
        clearTimeout(timeoutId);
        timeoutId = undefined;
    };
    const start = () => {
        if (timeoutId)
            stop();
        timeoutId = setTimeout(async () => {
            await fn();
            start();
        }, timeout);
    };
    return {
        start,
        stop
    };
}
//# sourceMappingURL=timeout.js.map