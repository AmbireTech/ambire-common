function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function waitWithAbort(ms) {
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
export default wait;
//# sourceMappingURL=wait.js.map