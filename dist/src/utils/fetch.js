"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWithTimeout = void 0;
const fetchWithTimeout = async (fetch, url, options, timeout) => {
    const controller = new AbortController();
    let timeoutId;
    try {
        // The race is kept as the backstop, for a `fetch` that ignores the signal. The abort is
        // what frees the socket the abandoned request would otherwise keep holding - and that
        // matters, because our RPCs share one host whose few connections everything else queues on.
        return await Promise.race([
            fetch(url, { ...options, signal: controller.signal }),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    controller.abort();
                    reject(new Error('request-timeout'));
                }, timeout);
            })
        ]);
    }
    finally {
        clearTimeout(timeoutId);
    }
};
exports.fetchWithTimeout = fetchWithTimeout;
//# sourceMappingURL=fetch.js.map