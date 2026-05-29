"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.yieldToMain = yieldToMain;
/**
 * Allow the main thread to process other events.
 */
function yieldToMain() {
    if (globalThis?.scheduler?.yield) {
        return globalThis.scheduler.yield();
    }
    // Fall back to yielding with setTimeout.
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}
//# sourceMappingURL=scheduler.js.map