"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitWithAbort = waitWithAbort;
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function waitWithAbort(ms) {
    let timeoutId;
    const promise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            resolve();
        }, ms);
    });
    return {
        promise,
        abort: () => {
            clearTimeout(timeoutId);
        }
    };
}
exports.default = wait;
//# sourceMappingURL=wait.js.map