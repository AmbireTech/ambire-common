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
export { yieldToMain };
//# sourceMappingURL=scheduler.js.map