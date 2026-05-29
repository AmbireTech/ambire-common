const fetchWithTimeout = async (fetch, url, options, timeout) => {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('request-timeout'));
        }, timeout);
    });
    return Promise.race([fetch(url, options), timeoutPromise]);
};
export { fetchWithTimeout };
//# sourceMappingURL=fetch.js.map