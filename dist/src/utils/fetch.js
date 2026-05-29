"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWithTimeout = void 0;
const fetchWithTimeout = async (fetch, url, options, timeout) => {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('request-timeout'));
        }, timeout);
    });
    return Promise.race([fetch(url, options), timeoutPromise]);
};
exports.fetchWithTimeout = fetchWithTimeout;
//# sourceMappingURL=fetch.js.map